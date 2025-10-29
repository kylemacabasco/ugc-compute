// Monitor and Execute Squads Proposals
// Location: sol/payout/monitor-proposals.ts
import "dotenv/config";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as multisig from "@sqds/multisig";
import bs58 from "bs58";
import {
  getServiceClient,
  markWithdrawalBroadcast,
  markWithdrawalConfirmed,
  markWithdrawalFinalized,
  markWithdrawalFailed,
} from "./helpers";

const RPC_URL = process.env.SOLANA_RPC_URL;
const TREASURY_PRIVATE_KEY = process.env.TREASURY_PRIVATE_KEY;
const MULTISIG_ADDRESS = process.env.SQUADS_MULTISIG_ADDRESS;

if (!RPC_URL) throw new Error("SOLANA_RPC_URL not set");
if (!TREASURY_PRIVATE_KEY) throw new Error("TREASURY_PRIVATE_KEY not set");
if (!MULTISIG_ADDRESS) throw new Error("SQUADS_MULTISIG_ADDRESS not set");

export async function monitorProposals() {
  console.log("\nMonitoring Squads proposals...");

  const connection = new Connection(RPC_URL, "confirmed");
  const executor = Keypair.fromSecretKey(bs58.decode(TREASURY_PRIVATE_KEY));
  const multisigPda = new PublicKey(MULTISIG_ADDRESS);

  const db = getServiceClient();

  // Fetch pending withdrawals
  const { data: withdrawals, error } = await db
    .from("withdrawal_payouts")
    .select("*")
    .in("status", ["proposal_created", "approved"])
    .not("squads_proposal_id", "is", null);

  if (error) {
    throw new Error(`Failed to fetch withdrawals: ${error.message}`);
  }

  if (!withdrawals || withdrawals.length === 0) {
    console.log("No pending proposals");
    return;
  }

  console.log(`\nFound ${withdrawals.length} pending proposals`);

  // Check each proposal status
  for (const withdrawal of withdrawals) {
    try {
      await checkProposalStatus(
        connection,
        executor,
        multisigPda,
        withdrawal
      );
    } catch (error: any) {
      console.error(`Error checking ${withdrawal.id}:`, error.message);
    }
  }

  console.log("\nMonitoring complete");
}

async function checkProposalStatus(
  connection: Connection,
  executor: Keypair,
  multisigPda: PublicKey,
  withdrawal: any
) {
  const db = getServiceClient();
  
  console.log(`\nChecking ${withdrawal.to_address.slice(0, 8)}...`);

  const transactionIndex = BigInt(withdrawal.squads_transaction_index);

  // Get proposal PDA
  const [proposalPda] = multisig.getProposalPda({
    multisigPda,
    transactionIndex,
  });

  // Fetch proposal account
  let proposal;
  try {
    proposal = await multisig.accounts.Proposal.fromAccountAddress(
      connection,
      proposalPda
    );
  } catch (error) {
    console.log("   Proposal not found on-chain");
    return;
  }

  console.log(`   Status: ${JSON.stringify(proposal.status)}`);

  const isApproved = "approved" in proposal.status;
  const isExecuted = "executed" in proposal.status;
  const isRejected = "rejected" in proposal.status;
  const isCancelled = "cancelled" in proposal.status;

  if (isRejected || isCancelled) {
    console.log("   Proposal rejected/cancelled");
    await markWithdrawalFailed(
      db,
      withdrawal.id,
      `Proposal ${isRejected ? "rejected" : "cancelled"}`
    );
    return;
  }

  if (isExecuted) {
    console.log("   Already executed");
    
    if (!withdrawal.tx_sig) {
      await markWithdrawalFinalized(db, withdrawal.id);
      console.log("   Marked as finalized");
    }
    
    return;
  }

  if (!isApproved) {
    console.log("   Waiting for approval");
    return;
  }

  // Execute approved proposal
  console.log("   Approved! Executing...");

  try {
    const signature = await multisig.rpc.vaultTransactionExecute({
      connection,
      feePayer: executor,
      multisigPda,
      transactionIndex,
      member: executor.publicKey,
    });

    console.log("   Executed:", signature);

    await markWithdrawalBroadcast(db, {
      withdrawalId: withdrawal.id,
      txSig: signature,
    });

    console.log("   Waiting for confirmation...");
    const confirmation = await connection.confirmTransaction(signature, "confirmed");

    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }

    await markWithdrawalConfirmed(db, {
      withdrawalId: withdrawal.id,
    });

    console.log("   Confirmed!");

    await connection.confirmTransaction(signature, "finalized");
    
    await markWithdrawalFinalized(db, withdrawal.id);
    
    console.log("   Finalized!");

  } catch (error: any) {
    console.error("   Execution failed:", error.message);
    await markWithdrawalFailed(db, withdrawal.id, error.message);
  }
}

export async function approveProposal(transactionIndex: number) {
  console.log("\nApproving proposal:", transactionIndex);

  const connection = new Connection(RPC_URL, "confirmed");
  const approver = Keypair.fromSecretKey(bs58.decode(TREASURY_PRIVATE_KEY));
  const multisigPda = new PublicKey(MULTISIG_ADDRESS);

  try {
    const signature = await multisig.rpc.proposalApprove({
      connection,
      feePayer: approver,
      multisigPda,
      transactionIndex: BigInt(transactionIndex),
      member: approver,
    });

    console.log("Approved:", signature);
    return signature;

  } catch (error: any) {
    console.error("Approval failed:", error.message);
    throw error;
  }
}

if (require.main === module) {
  const command = process.argv[2];

  if (command === "approve") {
    const txIndex = parseInt(process.argv[3]);
    if (isNaN(txIndex)) {
      console.error("Usage: ts-node monitor-proposals.ts approve <TX_INDEX>");
      process.exit(1);
    }

    approveProposal(txIndex)
      .then(() => process.exit(0))
      .catch(error => {
        console.error(error);
        process.exit(1);
      });
  } else {
    monitorProposals()
      .then(() => process.exit(0))
      .catch(error => {
        console.error("\nError:", error.message);
        process.exit(1);
      });
  }
}