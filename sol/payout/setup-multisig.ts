// sol/payout/setup-multisig.ts
import "dotenv/config";
import {
  Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction,
  sendAndConfirmTransaction
} from "@solana/web3.js";
import * as multisig from "@sqds/multisig";
import bs58 from "bs58";

async function setupMultisig() {
  const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
  if (!RPC_URL) throw new Error("NEXT_PUBLIC_SOLANA_RPC_URL not set");

  const connection = new Connection(RPC_URL, "confirmed");
  console.log("Connected to:", RPC_URL);

  const PRIVATE_KEY = process.env.TREASURY_PRIVATE_KEY;
  if (!PRIVATE_KEY) throw new Error("TREASURY_PRIVATE_KEY not set");

  const creator = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
  console.log("Creator wallet:", creator.publicKey.toBase58());

  const balance = await connection.getBalance(creator.publicKey);
  console.log("Balance:", balance / LAMPORTS_PER_SOL, "SOL");
  if (balance < 0.02 * LAMPORTS_PER_SOL) {
    console.log("Warning: top up to ~0.02 SOL to cover rent/fees.");
  }

  // Use SAME program id everywhere and correct cluster
  const PROGRAM_ID = new PublicKey("SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf");

  // Required in Squads v4: createKey must also sign
  const createKey = Keypair.generate();

  // Multisig PDA (SDK helper; pass programId explicitly)
  const [multisigPda] = multisig.getMultisigPda({
    createKey: createKey.publicKey,
    programId: PROGRAM_ID,
  });

  // Rent collector PDA (your SDK doesn't have getRentCollectorPda → derive with correct seeds)
  const [rentCollectorPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("rent_collector"), multisigPda.toBuffer()],
    PROGRAM_ID
  );

  console.log("\nMembers:");
  console.log("  1.", creator.publicKey.toBase58());
  console.log("Threshold: 1");
  console.log("Multisig PDA:", multisigPda.toBase58());
  console.log("Rent Collector PDA:", rentCollectorPda.toBase58());

  try {
    // Build the instruction via SDK
    const ix = await multisig.rpc.multisigCreateV2({
      connection,
      programId: PROGRAM_ID,
      createKey,
      creator,
      multisigPda,
      rentCollector: rentCollectorPda,
      treasury: creator.publicKey,
      configAuthority: creator.publicKey,
      threshold: 1,
      timeLock: 0,
      members: [
        { key: creator.publicKey, permissions: multisig.types.Permissions.all() },
      ],
      // NOTE: some SDK versions return a signature directly; others return an Instruction.
      // If yours returns a signature, you can skip the manual tx below and just confirm it.
      // The block below works when `multisig.rpc.multisigCreateV2` returns an Instruction.
    });

    // If your SDK returns a signature (string), use this simpler path:
    // const sig = await multisig.rpc.multisigCreateV2({ ...same args... });
    // await connection.confirmTransaction(
    //   { signature: sig, ...(await connection.getLatestBlockhash()) },
    //   "confirmed"
    // );

    // If it returned an Instruction instead:
    // const tx = new Transaction().add(ix);
    // const sig = await sendAndConfirmTransaction(connection, tx, [creator, createKey], { commitment: "confirmed" });

    // But your previous code suggested it returned a signature, so keep this:
    const signature = await multisig.rpc.multisigCreateV2({
      connection,
      programId: PROGRAM_ID,
      createKey,
      creator,
      multisigPda,
      rentCollector: rentCollectorPda,
      treasury: creator.publicKey,
      configAuthority: creator.publicKey,
      threshold: 1,
      timeLock: 0,
      members: [
        { key: creator.publicKey, permissions: multisig.types.Permissions.all() },
      ],
    });

    console.log("\nTx sent:", signature);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
    console.log("✅ Multisig created:", multisigPda.toBase58());

    // Vault PDA (SDK helper; pass programId)
    const [vaultPda] = multisig.getVaultPda({
      multisigPda,
      index: 0,
      programId: PROGRAM_ID,
    });

    console.log("Vault Address:", vaultPda.toBase58());
    console.log("\nAdd to .env:");
    console.log(`SQUADS_MULTISIG_ADDRESS=${multisigPda.toBase58()}`);
    console.log(`SQUADS_VAULT_ADDRESS=${vaultPda.toBase58()}`);
  } catch (error: any) {
    console.error("\nError creating multi-sig:", error?.message || error);
    if (error?.logs) {
      console.error("\nTransaction logs:");
      for (const log of error.logs) console.error("  ", log);
    }
    throw error;
  }
}

setupMultisig().catch(console.error);
