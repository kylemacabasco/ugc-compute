// Setup Squads Multi-sig (One-time setup)
// Location: sol/payout/setup-multisig.ts
import "dotenv/config";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import * as multisig from "@sqds/multisig";
import bs58 from "bs58";

async function setupMultisig() {
  // ============================================================================
  // 1. SETUP CONNECTION
  // ============================================================================
  const RPC_URL = process.env.SOLANA_RPC_URL;
  if (!RPC_URL) throw new Error("SOLANA_RPC_URL not set");

  const connection = new Connection(RPC_URL, "confirmed");
  console.log("Connected to:", RPC_URL);

  // ============================================================================
  // 2. LOAD TREASURY KEYPAIR (Creator of the multi-sig)
  // ============================================================================
  // Option A: From base58 private key
  const PRIVATE_KEY = process.env.TREASURY_PRIVATE_KEY;
  if (!PRIVATE_KEY) {
    throw new Error(
      "TREASURY_PRIVATE_KEY not set. Generate one with: solana-keygen new"
    );
  }

  const creator = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
  console.log(" Creator wallet:", creator.publicKey.toBase58());

  // Check balance
  const balance = await connection.getBalance(creator.publicKey);
  console.log(" Balance:", balance / LAMPORTS_PER_SOL, "SOL");

  if (balance < 0.1 * LAMPORTS_PER_SOL) {
    console.log("\n Low balance! Get devnet SOL:");
    console.log("   solana airdrop 2", creator.publicKey.toBase58(), "--url devnet");
    return;
  }

  // ============================================================================
  // 3. DEFINE MULTI-SIG MEMBERS
  // ============================================================================
  // For testing with ONE user, we'll use the creator as the only member
  // Later, add more members for true multi-sig
  
  const members = [
    {
      key: creator.publicKey,
      permissions: multisig.types.Permissions.all(), // Full permissions
    },
    // Add more members here later:
    // {
    //   key: new PublicKey("MEMBER_2_PUBKEY"),
    //   permissions: multisig.types.Permissions.all(),
    // },
  ];

  console.log("\n Multi-sig Members:");
  members.forEach((m, i) => console.log(`   ${i + 1}. ${m.key.toBase58()}`));

  // ============================================================================
  // 4. CREATE MULTI-SIG
  // ============================================================================
  const threshold = 1; // 1-of-1 for testing, increase when adding more members
  
  console.log("\n Creating multi-sig with threshold:", threshold);

  // Generate a unique create key for this multi-sig
  const createKey = Keypair.generate();

  // Derive the multi-sig PDA
  const [multisigPda] = multisig.getMultisigPda({
    createKey: createKey.publicKey,
  });

  console.log("📝 Multi-sig PDA:", multisigPda.toBase58());

  try {
    // Create the multi-sig account
    const signature = await multisig.rpc.multisigCreate({
      connection,
      createKey,
      creator,
      multisigPda,
      configAuthority: null, // Can be set to upgrade config later
      timeLock: 0, // No time delay for testing
      threshold,
      members,
    });

    console.log("\n Multi-sig created!");
    console.log("   Signature:", signature);
    console.log("   Multi-sig Address:", multisigPda.toBase58());

    // Derive the vault (where funds are held)
    const [vaultPda] = multisig.getVaultPda({
      multisigPda,
      index: 0, // Default vault index
    });

    console.log("\n Vault Address:", vaultPda.toBase58());
    console.log("\n Add these to your .env:");
    console.log(`SQUADS_MULTISIG_ADDRESS=${multisigPda.toBase58()}`);
    console.log(`SQUADS_VAULT_ADDRESS=${vaultPda.toBase58()}`);

    console.log("\n Fund the vault with:");
    console.log(`solana transfer ${vaultPda.toBase58()} 1 --url devnet`);

  } catch (error: any) {
    console.error("\n Error creating multi-sig:", error.message);
    throw error;
  }
}

// Run the setup
setupMultisig().catch(console.error);