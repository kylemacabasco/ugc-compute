// Quick Test Script - Simulate full payout flow
// Location: sol/payout/test-flow.ts
import "dotenv/config";
import { processContractPayouts } from "./create-proposals";
import { monitorProposals, approveProposal } from "./monitor-proposals";

async function testPayoutFlow() {
  console.log("🧪 Testing Complete Payout Flow\n");
  console.log("=" .repeat(50));

  // Get contract ID from command line
  const contractId = process.argv[2];
  
  if (!contractId) {
    console.error("\n❌ Usage: ts-node test-flow.ts <CONTRACT_ID>");
    console.error("\nExample: ts-node test-flow.ts test-contract-1");
    process.exit(1);
  }

  try {
    // ============================================================================
    // STEP 1: Create Proposals
    // ============================================================================
    console.log("\n📝 STEP 1: Creating payout proposals...\n");
    await processContractPayouts(contractId);
    
    console.log("\n" + "=".repeat(50));
    console.log("⏳ Waiting 5 seconds for blockchain confirmation...");
    await sleep(5000);

    // ============================================================================
    // STEP 2: Auto-approve (only works for 1-of-1 testing)
    // ============================================================================
    console.log("\n✅ STEP 2: Auto-approving proposals...\n");
    
    // In production, this would be done manually via Squads UI
    // For testing, we'll approve transaction index 1
    // (You may need to adjust this if you have multiple transactions)
    
    console.log("⚠️  Note: For 1-of-1 multi-sig, approval is automatic");
    console.log("   For M-of-N, approve via: ts-node monitor-proposals.ts approve <TX_INDEX>");
    
    console.log("\n" + "=".repeat(50));
    console.log("⏳ Waiting 3 seconds...");
    await sleep(3000);

    // ============================================================================
    // STEP 3: Monitor and Execute
    // ============================================================================
    console.log("\n🚀 STEP 3: Monitoring and executing proposals...\n");
    await monitorProposals();

    // ============================================================================
    // COMPLETE
    // ============================================================================
    console.log("\n" + "=".repeat(50));
    console.log("✅ PAYOUT FLOW COMPLETE!\n");
    console.log("📊 Check your database 'withdrawals' table to verify status.");
    console.log("💰 Check user wallet balance on Solana Explorer:");
    console.log("   https://explorer.solana.com/?cluster=devnet\n");

  } catch (error: any) {
    console.error("\n❌ Test failed:", error.message);
    console.error("\n🔍 Troubleshooting:");
    console.error("   1. Make sure contract exists and status is 'completed'");
    console.error("   2. Verify vault has sufficient funds");
    console.error("   3. Check user has wallet_address set");
    console.error("   4. Ensure SQUADS_MULTISIG_ADDRESS is set in .env\n");
    process.exit(1);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run the test
testPayoutFlow();