#!/usr/bin/env ts-node
// scripts/solana-payout.ts
import 'dotenv/config';
import {
  Connection, Keypair, PublicKey, SystemProgram,
  Transaction, ComputeBudgetProgram, sendAndConfirmTransaction
} from '@solana/web3.js';
import bs58 from 'bs58';
import { createSupabaseServiceClient } from '../lib/supabase.js';

type Recipient = { address: string; amountSOL: number; user_id?: string };

const LOG = '[payout]';
const DRY_RUN = String(process.env.DRY_RUN ?? 'false') === 'true'; // default: live
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const TREASURY_ADDRESS = process.env.TREASURY_ADDRESS || ''; // optional safety

function lamports(sol: number) { return Math.round(sol * 1e9); }

function loadKeypair(): Keypair {
  const json = process.env.SOL_WALLET_SECRET_KEY_JSON;
  const b58  = process.env.SOL_WALLET_SECRET_KEY;
  if (json) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(json)));
  if (b58)  return Keypair.fromSecretKey(bs58.decode(b58));
  throw new Error('Set SOL_WALLET_SECRET_KEY_JSON or SOL_WALLET_SECRET_KEY (private key of payer/treasury)');
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out: any = { maxPerTx: 8 };
  for (let i=0;i<args.length;i++){
    const k = args[i];
    if (k==='--plan') out.plan = args[++i];
    else if (k==='--contract') out.contract = args[++i];
    else if (k==='--maxPerTx') out.maxPerTx = Number(args[++i] || '8');
  }
  if (!out.plan && !out.contract) throw new Error('Provide --plan <file.json> or --contract <ID>');
  return out;
}

async function loadPlanFromFile(path:string): Promise<Recipient[]> {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(path,'utf8');
  const arr = JSON.parse(raw);
  if (!Array.isArray(arr)) throw new Error('Plan file must be an array');
  return arr as Recipient[];
}

// Supabase mode: uses payouts + RPC compute_payout_plan if present, else aggregates submissions
async function loadPlanFromSupabase(contractId:string): Promise<{ payoutId: string; recipients: Recipient[] }> {
  const db = createSupabaseServiceClient();

  // ensure a payouts row exists
  let payoutId: string;
  {
    const { data: existing, error } = await db
      .from('payouts')
      .select('id,status')
      .eq('contract_id', contractId)
      .in('status', ['queued','in_progress'])
      .limit(1);
    if (error) throw new Error(error.message);
    if (existing?.length) payoutId = existing[0].id;
    else {
      const { data: created, error: e2 } = await db
        .from('payouts')
        .insert({ contract_id: contractId, status: 'queued' })
        .select('id')
        .single();
      if (e2) throw new Error(e2.message);
      payoutId = created!.id;
    }
  }

  // try RPC first
  let rows: any[] = [];
  const { data: rpcRows, error: rpcErr } = await db.rpc('compute_payout_plan', { in_contract_id: contractId });
  if (!rpcErr && rpcRows) {
    rows = rpcRows as any[];
  } else {
    // fallback: aggregate approved submissions
    const { data: subs, error: subsErr } = await db
      .from('submissions')
      .select('user_id, earned_amount, wallet_address')
      .eq('contract_id', contractId)
      .eq('status','approved');
    if (subsErr) throw new Error(subsErr.message);
    const byUser = new Map<string, { wallet: string; sum: number }>();
    for (const s of subs ?? []) {
      const uid = s.user_id as string;
      const wallet = String((s as any).wallet_address || '');
      const amt = Number((s as any).earned_amount || 0);
      if (!uid || !wallet || amt <= 0) continue;
      const prev = byUser.get(uid) ?? { wallet, sum: 0 };
      prev.sum += amt;
      byUser.set(uid, prev);
    }
    rows = Array.from(byUser.entries()).map(([user_id, v]) => ({
      user_id, wallet_address: v.wallet, payable_sol: v.sum
    }));
  }

  const recipients: Recipient[] = rows
    .map(r => ({ address: String(r.wallet_address || ''), amountSOL: Number(r.payable_sol || 0), user_id: r.user_id }))
    .filter(x => x.address && x.amountSOL > 0);

  return { payoutId, recipients };
}

async function markPayoutStatus(
  payoutId:string,
  status:'queued'|'in_progress'|'paid'|'failed',
  extra?:Partial<{ total:number; txCount:number; last_error:string }>
){
  const db = createSupabaseServiceClient();
  const { error } = await db
    .from('payouts')
    .update({ status, total_disbursed: extra?.total, tx_count: extra?.txCount, last_error: extra?.last_error, updated_at: new Date().toISOString() })
    .eq('id', payoutId);
  if (error) throw new Error(error.message);
}

async function ensureTransferRow(payoutId:string, contractId:string, r:Recipient): Promise<string> {
  const db = createSupabaseServiceClient();
  const { data, error } = await db
    .from('payout_transfers')
    .select('id,status,tx_sig')
    .eq('payout_id', payoutId)
    .eq('to_address', r.address)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return data.id;
  const { data: ins, error: e2 } = await db
    .from('payout_transfers')
    .insert({ payout_id: payoutId, contract_id: contractId, user_id: r.user_id ?? null, to_address: r.address, amount_sol: r.amountSOL, status: 'queued' })
    .select('id')
    .single();
  if (e2) throw new Error(e2.message);
  return ins!.id;
}

async function updateTransferRow(id:string, patch:Record<string, any>) {
  const db = createSupabaseServiceClient();
  const { error } = await db.from('payout_transfers').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(error.message);
}

function chunk<T>(arr:T[], size:number): T[][] {
  const out:T[][] = [];
  for (let i=0;i<arr.length;i+=size) out.push(arr.slice(i,i+size));
  return out;
}

async function sendBatch(conn: Connection, payer: Keypair, batch: Recipient[]): Promise<string> {
  const ixs = [];
  const tip = Number(process.env.PRIORITY_FEE_MICROLAMPORTS || 0);
  if (tip > 0) ixs.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: tip }));
  for (const r of batch) {
    ixs.push(SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: new PublicKey(r.address),
      lamports: lamports(r.amountSOL),
    }));
  }
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('finalized');
  const tx = new Transaction({ blockhash, lastValidBlockHeight, feePayer: payer.publicKey }).add(...ixs);
  tx.sign(payer);
  if (DRY_RUN) return 'DRY_RUN';
  return await sendAndConfirmTransaction(conn, tx, [payer], { commitment: 'confirmed' });
}

async function main() {
  const args = parseArgs();
  const conn = new Connection(RPC_URL, 'confirmed');
  const payer = loadKeypair();

  // safety: verify payer matches expected treasury address if provided
  if (TREASURY_ADDRESS) {
    const expect = new PublicKey(TREASURY_ADDRESS).toBase58();
    const actual = payer.publicKey.toBase58();
    if (expect !== actual) {
      throw new Error(`Payer keypair ${actual} does not match TREASURY_ADDRESS ${expect}`);
    }
  }

  let payoutId = 'ad-hoc';
  let contractId = args.contract ?? 'ad-hoc';
  let recipients: Recipient[] = [];

  if (args.plan) {
    recipients = await loadPlanFromFile(args.plan);
  } else {
    const loaded = await loadPlanFromSupabase(args.contract);
    payoutId = loaded.payoutId;
    recipients = loaded.recipients;
    contractId = args.contract;
  }

  if (!recipients.length) {
    console.log(`${LOG} nothing to pay`);
    return;
  }

  console.log(`${LOG} start payout=${payoutId} recipients=${recipients.length} dryRun=${DRY_RUN}`);
  if (payoutId !== 'ad-hoc') await markPayoutStatus(payoutId, 'in_progress');

  const ready: { rowId: string; r: Recipient }[] = [];
  for (const r of recipients) {
    const rowId = payoutId === 'ad-hoc'
      ? `adhoc-${r.address}-${r.amountSOL}-${Date.now()}`
      : await ensureTransferRow(payoutId, contractId, r);
    ready.push({ rowId, r });
  }

  const batches = chunk(ready, Number(args.maxPerTx) || 8);
  let sent = 0;
  let total = 0;

  for (const b of batches) {
    const sig = await sendBatch(conn, payer, b.map(x => x.r));
    for (const x of b) {
      total += x.r.amountSOL;
      if (payoutId !== 'ad-hoc') await updateTransferRow(x.rowId, { status: 'confirmed', tx_sig: sig });
      sent++;
    }
    console.log(`${LOG} batch ok sig=${sig} recipients=${sent}/${ready.length} total=${total.toFixed(6)} SOL`);
  }

  if (payoutId !== 'ad-hoc') await markPayoutStatus(payoutId, 'paid', { total, txCount: batches.length });
  console.log(`${LOG} done ✔`);
}

main().catch(async (e) => {
  console.error(`${LOG} failed:`, e?.message ?? e);
  try {
    const args = parseArgs();
    if (args.contract) {
      const db = createSupabaseServiceClient();
      const { data } = await db.from('payouts').select('id').eq('contract_id', args.contract).in('status', ['queued','in_progress']).limit(1);
      const pid = data?.[0]?.id;
      if (pid) await markPayoutStatus(pid, 'failed', { last_error: e?.message ?? String(e) });
    }
  } catch {}
  process.exit(1);
});
