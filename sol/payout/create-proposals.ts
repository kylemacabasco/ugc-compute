// Create Squads proposals for contract payouts
// Location: sol/payout/create-proposals.ts
import "dotenv/config";
import { Connection, Keypair, PublicKey, SystemProgram, TransactionMessage } from "@solana/web3.js";
import * as multisig from "@sqds/multisig";
import bs58 from "bs58";
import {
  getServiceClient,
  calculateProportionalPayouts,
  markWithdrawalProposalCreated,
  markWithdrawalFailed,
  type UserEarnings,
} from "./helpers";

const RPC_URL = process.env.SOLANA_RPC_URL;
const TREASURY_PRIVATE_KEY = process.env.TREASURY_PRIVATE_KEY;
const MULTISIG_ADDRESS = process.env.SQUADS_MULTISIG_ADDRESS;

if (!RPC_URL) throw new Error("SOLANA_RPC_URL not set");
if (!TREASURY_PRIVATE_KEY) throw new Error("TREASURY_PRIVATE_KEY not set");
if (!MULTISIG_ADDRESS) throw new Error("SQUADS_MULTISIG_ADDRESS not set");

export async function processContractPayouts(contractId: string) {
  console.log("\nProcessing payouts for contract:", contractId);

  const connection = new Connection(RPC_URL, "confirmed");
  const creator = Keypair.fromSecretKey(bs58.decode(TREASURY_PRIVATE_KEY));
  const multisigPda = new PublicKey(MULTISIG_ADDRESS);

  const [vaultPda] = multisig.getVaultPda({ multisigPda, index: 0 });
  console.log("Vault address:", vaultPda.toBase58());

  const db = getServiceClient();

  // Fetch contract
  const { data: contract, error: contractError } = await db
    .from("contracts")
    .select("*")
    .eq("id", contractId)
    .single();

  if (contractError || !contract) {
    throw new Error(`Contract ${contractId} not found`);
  }

  console.log("\nContract Details:");
  console.log("   Budget:", contract.contract_amount, "SOL");
  console.log("   Rate:", contract.rate_per_1k_views, "SOL/1k views");
  console.log("   Status:", contract.status);

  // Fetch submissions with user wallet addresses
  const { data: submissions, error: submissionsError } = await db
    .from("submissions")
    .select(`
      id,
      user_id,
      view_count,
      users!inner(wallet_address)
    `)
    .eq("contract_id", contractId)
    .eq("status", "approved")
    .not("users.wallet_address", "is", null);

  if (submissionsError) {
    throw new Error(`Failed to fetch submissions: ${submissionsError.message}`);
  }

  if (!submissions || submissions.length === 0) {
    console.log("No approved submissions found");
    return;
  }

  console.log("\nFound", submissions.length, "submissions");

  // Calculate proportional payouts
  const userSubmissions = submissions.map(sub => ({
    userId: sub.user_id,
    walletAddress: (sub.users as any).wallet_address,
    submissionId: sub.id,
    viewsAchieved: sub.view_count || 0,
  }));

  const earnings = calculateProportionalPayouts({
    contractBudget: parseFloat(contract.contract_amount),
    ratePerThousandViews: parseFloat(contract.rate_per_1k_views),
    userSubmissions,
  });

  console.log("\nPayout Breakdown:");
  earnings.forEach(e => {
    console.log(`   ${e.walletAddress.slice(0, 8)}... -> ${e.actualPayout.toFixed(4)} SOL (${e.viewsAchieved.toLocaleString()} views)`);
  });

  // Create withdrawal records
  const withdrawals = [];
  
  for (const earning of earnings) {
    const { data: wd, error: wdError } = await db
      .from("withdrawal_payouts")
      .insert({
        user_id: earning.userId,
        contract_id: contractId,
        submission_id: earning.submissionId,
        from_address: vaultPda.toBase58(),
        to_address: earning.walletAddress,
        mint: null,
        amount_base_units: earning.actualPayoutLamports.toString(),
        decimals: 9,
        ui_amount: earning.actualPayout.toString(),
        status: "approved",
        views_achieved: earning.viewsAchieved,
        earned_amount: earning.earnedAmount,
        actual_payout: earning.actualPayout,
      })
      .select()
      .single();

    if (wdError) {
      console.error(`Failed to create withdrawal for ${earning.walletAddress}:`, wdError.message);
      continue;
    }

    withdrawals.push({ withdrawal: wd, earning });
  }

  console.log("\nCreated", withdrawals.length, "withdrawal records");

  // Create Squads proposals
  console.log("\nCreating Squads proposals...");

  for (const { withdrawal, earning } of withdrawals) {
    try {
      await createSquadsProposal(
        connection,
        creator,
        multisigPda,
        vaultPda,
        withdrawal.id,
        earning
      );
    } catch (error: any) {
      console.error(`Failed to create proposal for ${earning.walletAddress}:`, error.message);
      await markWithdrawalFailed(db, withdrawal.id, error.message);
    }
  }

  console.log("\nAll proposals created!");
}

async function createSquadsProposal(
  connection: Connection,
  creator: Keypair,
  multisigPda: PublicKey,
  vaultPda: PublicKey,
  withdrawalId: string,
  earning: UserEarnings
) {
  const db = getServiceClient();

  console.log(`\n   Creating proposal for ${earning.walletAddress.slice(0, 8)}...`);

  const multisigInfo = await multisig.accounts.Multisig.fromAccountAddress(
    connection,
    multisigPda
  );

  const currentTransactionIndex = Number(multisigInfo.transactionIndex);
  const newTransactionIndex = BigInt(currentTransactionIndex + 1);

  console.log(`   Transaction index: ${newTransactionIndex}`);

  const transferInstruction = SystemProgram.transfer({
    fromPubkey: vaultPda,
    toPubkey: new PublicKey(earning.walletAddress),
    lamports: earning.actualPayoutLamports,
  });

  const transferMessage = new TransactionMessage({
    payerKey: vaultPda,
    recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
    instructions: [transferInstruction],
  });

  const signature = await multisig.rpc.vaultTransactionCreate({
    connection,
    feePayer: creator,
    multisigPda,
    transactionIndex: newTransactionIndex,
    creator: creator.publicKey,
    vaultIndex: 0,
    ephemeralSigners: 0,
    transactionMessage: transferMessage,
    memo: `Payout: ${earning.viewsAchieved.toLocaleString()} views`,
  });

  console.log(`   Proposal created: ${signature}`);

  await markWithdrawalProposalCreated(db, {
    withdrawalId,
    squadsProposalId: signature,
    squadsTransactionIndex: Number(newTransactionIndex),
  });

  console.log(`   Database updated`);
}

if (require.main === module) {
  const contractId = process.argv[2];
  
  if (!contractId) {
    console.error("Usage: ts-node create-proposals.ts <CONTRACT_ID>");
    process.exit(1);
  }

  processContractPayouts(contractId)
    .then(() => {
      console.log("\nDone!");
      process.exit(0);
    })
    .catch(error => {
      console.error("\nError:", error.message);
      process.exit(1);
    });
}