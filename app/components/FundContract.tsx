"use client";

import { useState, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
  TransactionInstruction,
} from "@solana/web3.js";

interface FundContractProps {
  contractId: string;
  contractAmount: number;
}

interface TreasuryInfo {
  treasury_wallet_address: string;
  reference_code: string | null;
  total_deposited: number;
  contract_status: string;
}

export default function FundContract({
  contractId,
  contractAmount,
}: FundContractProps) {
  const { publicKey, sendTransaction } = useWallet();
  const [treasuryInfo, setTreasuryInfo] = useState<TreasuryInfo | null>(null);
  const [depositAmount, setDepositAmount] = useState<string>(
    contractAmount.toString()
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    fetchTreasuryInfo();
  }, [contractId]);

  const fetchTreasuryInfo = async () => {
    try {
      const response = await fetch(`/api/contracts/${contractId}/treasury`);
      if (response.ok) {
        const data = await response.json();
        setTreasuryInfo(data);
      } else if (response.status === 400) {
        // Treasury not configured - show message
        setTreasuryInfo({
          treasury_wallet_address: "",
          reference_code: null,
          total_deposited: 0,
          contract_status: "awaiting_funding",
        });
        setError("Treasury wallet not configured. Please apply migration 005 in Supabase.");
      }
    } catch (err) {
      console.error("Failed to fetch treasury info:", err);
      setError("Failed to load treasury information");
    }
  };

  const handleDeposit = async () => {
    if (!publicKey || !treasuryInfo) {
      setError("Wallet not connected or treasury not configured");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const amount = parseFloat(depositAmount);
      if (isNaN(amount) || amount <= 0) {
        throw new Error("Invalid amount");
      }

      // Create Solana connection
      const connection = new Connection(
        process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
          "https://api.devnet.solana.com"
      );

      const treasuryPubkey = new PublicKey(
        treasuryInfo.treasury_wallet_address
      );
      const lamports = Math.floor(amount * LAMPORTS_PER_SOL);

      // Create transfer instruction
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: treasuryPubkey,
          lamports,
        })
      );

      // Add memo with reference code if available
      if (treasuryInfo.reference_code) {
        const MEMO_PROGRAM_ID = new PublicKey(
          "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
        );

        const memoInstruction = new TransactionInstruction({
          keys: [],
          programId: MEMO_PROGRAM_ID,
          data: Buffer.from(`ref:${treasuryInfo.reference_code}`, "utf-8"),
        });

        transaction.add(memoInstruction);
      }

      // Get latest blockhash
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;

      // Send transaction
      const signature = await sendTransaction(transaction, connection);

      // Wait for confirmation
      await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight,
      });

      setSuccess(true);
      setError(null);

      // Refresh treasury info
      setTimeout(() => {
        fetchTreasuryInfo();
      }, 2000);
    } catch (err: any) {
      console.error("Deposit failed:", err);
      setError(err.message || "Failed to deposit SOL");
    } finally {
      setLoading(false);
    }
  };

  if (!treasuryInfo) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-slate-200 dark:border-slate-800">
        <div className="animate-pulse">
          <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-3/4 mb-4"></div>
          <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  const remainingAmount = contractAmount - treasuryInfo.total_deposited;
  const isFunded = treasuryInfo.total_deposited >= contractAmount;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-slate-200 dark:border-slate-800">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-4">
        Fund Contract
      </h3>

      {/* Treasury Status */}
      <div className="mb-6 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-gray-600 dark:text-slate-400">
            Contract Amount:
          </span>
          <span className="font-semibold text-gray-900 dark:text-slate-100">
            {contractAmount} SOL
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-600 dark:text-slate-400">
            Total Deposited:
          </span>
          <span className="font-semibold text-gray-900 dark:text-slate-100">
            {treasuryInfo.total_deposited.toFixed(4)} SOL
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-600 dark:text-slate-400">Remaining:</span>
          <span className="font-semibold text-blue-600 dark:text-blue-400">
            {Math.max(0, remainingAmount).toFixed(4)} SOL
          </span>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mb-6">
        <div className="w-full bg-gray-200 dark:bg-slate-700 rounded-full h-2">
          <div
            className="bg-blue-600 h-2 rounded-full transition-all duration-500"
            style={{
              width: `${Math.min(
                (treasuryInfo.total_deposited / contractAmount) * 100,
                100
              )}%`,
            }}
          />
        </div>
      </div>

      {isFunded ? (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4 mb-4">
          <p className="text-sm text-green-800 dark:text-green-200 font-medium">
            ✓ Contract fully funded! Status: {treasuryInfo.contract_status}
          </p>
        </div>
      ) : (
        <>
          {/* Deposit Form */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                Deposit Amount (SOL)
              </label>
              <input
                type="number"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                min="0.001"
                step="0.001"
                className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100"
                disabled={loading}
              />
              <button
                onClick={() => setDepositAmount(remainingAmount.toString())}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline mt-1"
              >
                Set to remaining amount
              </button>
            </div>

            <button
              onClick={handleDeposit}
              disabled={loading || !publicKey}
              className="w-full bg-blue-600 dark:bg-blue-500 text-white font-semibold py-3 px-6 rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Processing…" : "Deposit SOL"}
            </button>
          </div>

          {/* Treasury Wallet Info */}
          <div className="mt-4 p-3 bg-gray-50 dark:bg-slate-800 rounded-lg">
            <p className="text-xs text-gray-600 dark:text-slate-400 mb-1">
              Treasury Wallet:
            </p>
            <p className="text-xs font-mono text-gray-900 dark:text-slate-100 break-all">
              {treasuryInfo.treasury_wallet_address}
            </p>
            {treasuryInfo.reference_code && (
              <>
                <p className="text-xs text-gray-600 dark:text-slate-400 mt-2 mb-1">
                  Reference Code:
                </p>
                <p className="text-xs font-mono text-gray-900 dark:text-slate-100">
                  {treasuryInfo.reference_code}
                </p>
              </>
            )}
          </div>
        </>
      )}

      {/* Error Message */}
      {error && (
        <div className="mt-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
          <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      {/* Success Message */}
      {success && (
        <div className="mt-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
          <p className="text-sm text-green-800 dark:text-green-200">
            ✓ Deposit successful! The indexer will process it shortly.
          </p>
        </div>
      )}
    </div>
  );
}
