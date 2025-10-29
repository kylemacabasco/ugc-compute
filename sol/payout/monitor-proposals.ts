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

// ============================================================================
// CONFIGURATION
// ============================================================================

const RPC_URL = process.env.SOLANA_RPC_URL;
const TREASURY_PRIVATE_KEY = process.env.TREASURY_PRIVATE_KEY;
const MULTISIG_ADDRESS = process.env.SQUADS_MULTISIG_ADDRESS;

if (!RPC_URL) throw new Error("SOLANA_RPC_URL not set");
if (!TREASURY_PRIVATE_KEY) throw new Error("TREASURY_PRIVATE_KEY not set");
if (!MULTISIG_ADDRESS) throw new Error("SQUADS_MULTISIG_ADDRESS not set");

// ============================================================================
// MONITOR PENDING PROPOSALS
// ============================================================================

export async function monitorProposals() {
  console.log("\n Monitoring Squads proposals...");

  const connection = new Connection(RPC_URL, "confirmed");
  const executor = Keypair.fromSecretKey(bs58.decode(TREASURY_PRIVATE_KEY));
  const multisigPda = new PublicKey(MULTISIG_ADDRESS);

  const db = getServiceClient();

  // ============================================================================
  // 1. FETCH PENDING WITHDRAWALS
  // ============================================================================

  const { data: withdrawals, error } = await db
    .from("withdrawals")
    .select("*")
    .in("status", ["proposal_created", "approved"])
    .not("squads_proposal_id", "is", null);

  if (error) {
    throw new Error(`Failed to fetch withdrawals: ${error.message}`);
  }

  if (!withdrawals || withdrawals.length === 0) {
    console.log(" No pending proposals");
    return;
  }

  console.log(`\n Found ${withdrawals.length} pending proposals`);

  // ============================================================================
  // 2. CHECK EACH PROPOSAL STATUS
  // ============================================================================

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

  console.log("\n Monitoring complete");
}

// ============================================================================
// CHECK INDIVIDUAL PROPOSAL
// ============================================================================

async function checkProposalStatus(
  connection: Connection,
  executor: Keypair,
  multisigPda: PublicKey,
  withdrawal: any
) {
  const db = getServiceClient();
  
  console.log(`\n Checking ${withdrawal.to_address.slice(0, 8)}...`);

  const transactionIndex = BigInt(withdrawal.squads_transaction_index);

  // ============================================================================
  // 1. GET PROPOSAL PDA
  // ============================================================================

  const [proposalPda] = multisig.getProposalPda({
    multisigPda,
    transactionIndex,
  });

  // ============================================================================
  // 2. FETCH PROPOSAL ACCOUNT
  // ============================================================================

  let proposal;
  try {
    proposal = await multisig.accounts.Proposal.fromAccountAddress(
      connection,
      proposalPda
    );
  } catch (error) {
    console.log("Proposal not found on-chain (may not be created yet)");
    return;
  }

  console.log(`   Status: ${JSON.stringify(proposal.status)}`);

  // ============================================================================
  // 3. CHECK IF APPROVED AND READY TO EXECUTE
  // ============================================================================

  const isApproved = "approved" in proposal.status;
  const isExecuted = "executed" in proposal.status;
  const isRejected = "rejected" in proposal.status;
  const isCancelled = "cancelled" in proposal.status;

  if (isRejected || isCancelled) {
    console.log("Proposal rejected/cancelled");
    await markWithdrawalFailed(
      db,
      withdrawal.id,
      `Proposal ${isRejected ? "rejected" : "cancelled"}`
    );
    return;
  }

  if (isExecuted) {
    console.log("Already executed");
    
    // Check if we have the transaction signature
    if (!withdrawal.tx_sig) {
      // Fetch transaction to get signature
      const [transactionPda] = multisig.getTransactionPda({
        multisigPda,
        index: transactionIndex,
      });

      try {
        const transaction = await multisig.accounts.VaultTransaction.fromAccountAddress(
          connection,
          transactionPda
        );

        // If executed, mark as finalized
        await markWithdrawalFinalized(db, withdrawal.id);
        console.log("Marked as finalized");
      } catch (error: any) {
        console.log("Could not fetch transaction details");
      }
    }
    
    return;
  }

  if (!isApproved) {
    console.log("Waiting for approval");
    return;
  }

  // ============================================================================
  // 4. EXECUTE APPROVED PROPOSAL
  // ============================================================================

  console.log("Approved! Executing...");

  try {
    const signature = await multisig.rpc.vaultTransactionExecute({
      connection,
      feePayer: executor,
      multisigPda,
      transactionIndex,
      member: executor.publicKey,
    });

    console.log("Executed:", signature);

    // Update database
    await markWithdrawalBroadcast(db, {
      withdrawalId: withdrawal.id,
      txSig: signature,
    });

    // Wait for confirmation
    console.log("Waiting for confirmation...");
    const confirmation = await connection.confirmTransaction(signature, "confirmed");

    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }

    await markWithdrawalConfirmed(db, {
      withdrawalId: withdrawal.id,
    });

    console.log("Confirmed!");

    // Wait for finalization
    await connection.confirmTransaction(signature, "finalized");
    
    await markWithdrawalFinalized(db, withdrawal.id);
    
    console.log("Finalized!");

  } catch (error: any) {
    console.error("Execution failed:", error.message);
    await markWithdrawalFailed(db, withdrawal.id, error.message);
  }
}

// ============================================================================
// APPROVE A PROPOSAL (Manual approval helper)
// ============================================================================

export async function approveProposal(transactionIndex: number) {
  console.log("\n Approving proposal:", transactionIndex);

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

// ============================================================================
// CLI EXECUTION
// ============================================================================

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
        console.error("\n Error:", error.message);
        process.exit(1);
      });
  }
}