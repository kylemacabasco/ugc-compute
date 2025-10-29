"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useAuth } from "@/app/providers/AuthProvider";
import { PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import Link from "next/link";

interface Contract {
  id: string;
  title: string;
  description: string;
  contract_amount: number;
  status: string;
  creator_id: string;
}

export default function FundContractPage() {
  const params = useParams();
  const router = useRouter();
  const wallet = useWallet();
  const { connection } = useConnection();
  const { user } = useAuth();

  const [contract, setContract] = useState<Contract | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDepositing, setIsDepositing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [txSignature, setTxSignature] = useState<string | null>(null);

  const treasuryAddress = process.env.NEXT_PUBLIC_TREASURY_ADDRESS;

  // Fetch contract details on mount
  useEffect(() => {
    if (params.id) {
      fetchContract();
    }
  }, [params.id]);

  // Validate treasury address is properly configured
  useEffect(() => {
    if (treasuryAddress) {
      try {
        new PublicKey(treasuryAddress);
      } catch (err) {
        setError("Invalid treasury address configured. Please contact support.");
      }
    } else {
      setError("Treasury address not configured. Please contact support.");
    }
  }, [treasuryAddress]);

  const fetchContract = async () => {
    try {
      setIsLoading(true);
      const response = await fetch("/api/contracts");
      if (!response.ok) {
        throw new Error("Failed to fetch contract");
      }

      const contracts = await response.json();
      const currentContract = contracts.find((c: Contract) => c.id === params.id);

      if (!currentContract) {
        throw new Error("Contract not found");
      }

      setContract(currentContract);

      // Check if user is the creator
      if (user && currentContract.creator_id !== user.id) {
        setError("Only the contract creator can fund this contract");
      }
    } catch (err) {
      console.error("Error:", err);
      setError(err instanceof Error ? err.message : "Failed to load contract");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeposit = async () => {
    // Check wallet connection
    if (!wallet.publicKey || !wallet.signTransaction) {
      setError("Please connect your wallet");
      return;
    }

    // Verify treasury address is configured
    if (!treasuryAddress) {
      setError("Treasury address not configured");
      return;
    }

    // Ensure contract data is loaded
    if (!contract) {
      setError("Contract details not loaded");
      return;
    }

    // Use the contract amount as the deposit amount
    const depositAmount = contract.contract_amount;

    // Validate treasury address is a valid Solana public key
    let treasuryPubkey: PublicKey;
    try {
      treasuryPubkey = new PublicKey(treasuryAddress);
    } catch (err) {
      setError("Invalid treasury address. Please contact support.");
      return;
    }

    // Check user has sufficient balance for deposit and fees
    try {
      const balance = await connection.getBalance(wallet.publicKey);
      const balanceInSol = balance / LAMPORTS_PER_SOL;
      const estimatedFee = 0.000005; // ~5000 lamports for transaction fee

      if (balanceInSol < depositAmount + estimatedFee) {
        setError(
          `Insufficient balance. You have ${balanceInSol.toFixed(4)} SOL but need ${(depositAmount + estimatedFee).toFixed(4)} SOL (including fees).`
        );
        return;
      }
    } catch (err) {
      console.error("Balance check error:", err);
      setError("Failed to check wallet balance. Please try again.");
      return;
    }

    setIsDepositing(true);
    setError(null);

    try {
      // Create simple SOL transfer transaction
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey: treasuryPubkey,
          lamports: Math.floor(depositAmount * LAMPORTS_PER_SOL),
        })
      );

      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = wallet.publicKey;

      // Sign and send transaction
      const signed = await wallet.signTransaction(transaction);
      const signature = await connection.sendRawTransaction(signed.serialize());

      console.log("Transaction sent:", signature);

      // Wait for confirmation using new API
      const latestBlockhash = await connection.getLatestBlockhash();
      await connection.confirmTransaction({
        signature,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      }, "confirmed");

      setTxSignature(signature);
      setSuccess(true);

      // Record the deposit in the database
      try {
        const depositResponse = await fetch("/api/deposits", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tx_sig: signature,
            contract_id: params.id,
            amount_sol: depositAmount,
            from_address: wallet.publicKey.toBase58(),
            to_address: treasuryAddress,
            user_id: user?.id,
          }),
        });

        if (!depositResponse.ok) {
          console.warn("Failed to record deposit:", await depositResponse.text());
        }
      } catch (err) {
        console.warn("Failed to record deposit:", err);
      }

      // Activate the contract (change status from awaiting_funding to open)
      try {
        const activateResponse = await fetch(`/api/contracts/${params.id}/activate`, {
          method: "POST",
        });

        if (!activateResponse.ok) {
          console.warn("Failed to activate contract automatically");
        }
      } catch (err) {
        console.warn("Failed to activate contract:", err);
      }
    } catch (err) {
      console.error("Deposit error:", err);
      setError(err instanceof Error ? err.message : "Failed to deposit. Please try again.");
    } finally {
      setIsDepositing(false);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-600">Please connect your wallet</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (error && !contract) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full bg-white rounded-lg shadow p-6">
          <div className="text-red-600 mb-4">{error}</div>
          <Link href="/" className="text-blue-600 hover:underline">
            ← Back to contracts
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <Link
            href={`/contracts/${params.id}`}
            className="text-blue-600 hover:underline mb-4 inline-block"
          >
            ← Back to contract
          </Link>
          <h1 className="text-3xl font-bold text-gray-900 mt-4">
            Fund Contract
          </h1>
        </div>

        {success ? (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-8 h-8 text-green-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              Deposit Successful!
            </h2>
            <p className="text-gray-600 mb-6">
              Your contract has been funded and is now open for submissions!
            </p>
            {txSignature && (
              <a
                href={`https://explorer.solana.com/tx/${txSignature}?cluster=mainnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline text-sm block mb-6"
              >
                View transaction on Solana Explorer →
              </a>
            )}
            <Link
              href={`/contracts/${params.id}`}
              className="inline-block px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors font-medium"
            >
              Back to Contract
            </Link>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow p-8">
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                {contract?.title}
              </h2>
              <p className="text-gray-600">{contract?.description}</p>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-6">
              <h3 className="font-semibold text-gray-900 mb-4">
                Deposit Details
              </h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-600">Required Amount:</span>
                  <span className="font-semibold text-gray-900">
                    {contract?.contract_amount} SOL
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Treasury:</span>
                  <span className="font-mono text-sm text-gray-900 break-all">
                    {treasuryAddress?.slice(0, 8)}...{treasuryAddress?.slice(-8)}
                  </span>
                </div>
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
                {error}
              </div>
            )}

            <button
              onClick={handleDeposit}
              disabled={isDepositing || !wallet.connected || (error !== null && contract !== null)}
              className="w-full px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {isDepositing
                ? "Processing..."
                : `Deposit ${contract?.contract_amount} SOL`}
            </button>

            {!wallet.connected && (
              <p className="text-center text-sm text-gray-500 mt-4">
                Please connect your wallet to continue
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
