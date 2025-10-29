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

  useEffect(() => {
    if (params.id) {
      fetchContract();
    }
  }, [params.id]);

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
    if (!wallet.publicKey || !wallet.signTransaction) {
      setError("Please connect your wallet");
      return;
    }

    if (!treasuryAddress) {
      setError("Treasury address not configured");
      return;
    }

    if (!contract) {
      setError("Contract details not loaded");
      return;
    }

    setIsDepositing(true);
    setError(null);

    try {
      // Create simple SOL transfer
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey: new PublicKey(treasuryAddress),
          lamports: Math.floor(contract.contract_amount * LAMPORTS_PER_SOL),
        })
      );

      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = wallet.publicKey;

      const signed = await wallet.signTransaction(transaction);
      const signature = await connection.sendRawTransaction(signed.serialize());

      await connection.confirmTransaction(signature, "confirmed");

      setTxSignature(signature);
      setSuccess(true);

      // Record the deposit
      try {
        await fetch("/api/deposits", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tx_sig: signature,
            contract_id: params.id,
            amount_sol: contract.contract_amount,
            from_address: wallet.publicKey.toBase58(),
            to_address: treasuryAddress,
            user_id: user?.id,
          }),
        });
      } catch (err) {
        console.warn("Failed to record deposit:", err);
      }

      // Update contract status to active
      const activateResponse = await fetch(`/api/contracts/${params.id}/activate`, {
        method: "POST",
      });

      if (!activateResponse.ok) {
        console.warn("Failed to activate contract automatically");
      }
    } catch (err) {
      console.error("Deposit error:", err);
      setError(err instanceof Error ? err.message : "Failed to deposit");
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
                href={`https://explorer.solana.com/tx/${txSignature}`}
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
                  <span className="text-gray-600">Amount:</span>
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

