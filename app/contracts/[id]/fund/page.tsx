"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useAuth } from "@/app/providers/AuthProvider";
import { depositToTreasury } from "@/lib/solanaDeposit";
import Link from "next/link";

interface Contract {
  id: string;
  title: string;
  description: string;
  contract_amount: number;
  status: string;
  creator_id: string;
  creator?: {
    wallet_address: string;
  };
}

export default function FundContractPage() {
  const params = useParams();
  const router = useRouter();
  const wallet = useWallet();
  const { connection } = useConnection();
  const { user } = useAuth();

  const [contract, setContract] = useState<Contract | null>(null);
  const [refCode, setRefCode] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDepositing, setIsDepositing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [txSignature, setTxSignature] = useState<string | null>(null);

  const treasuryAddress = process.env.NEXT_PUBLIC_TREASURY_ADDRESS;

  useEffect(() => {
    if (params.id && user && !refCode) {
      fetchContractAndGenerateRef();
    }
  }, [params.id, user]);

  const fetchContractAndGenerateRef = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Fetch contract details
      const contractResponse = await fetch(`/api/contracts`);
      if (!contractResponse.ok) {
        throw new Error("Failed to fetch contract");
      }

      const contracts = await contractResponse.json();
      const currentContract = contracts.find((c: Contract) => c.id === params.id);

      if (!currentContract) {
        throw new Error("Contract not found");
      }

      setContract(currentContract);

      // Check if user is the creator (compare by wallet address as fallback)
      if (!user) {
        setError("Please connect your wallet");
        return;
      }

      const isCreator =
        currentContract.creator_id === user.id ||
        currentContract.creator?.wallet_address === user.wallet_address;

      if (!isCreator) {
        setError("Only the contract creator can fund this contract");
        return;
      }

      // Generate reference code
      const refResponse = await fetch("/api/contracts/generate-ref", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contractId: params.id,
          userId: user.id,
          expiresInDays: 7,
        }),
      });

      const refData = await refResponse.json();

      if (!refResponse.ok) {
        console.error("Ref generation error:", refData);
        throw new Error(refData.error || "Failed to generate reference code");
      }

      if (!refData.ref_code) {
        console.error("No ref_code in response:", refData);
        throw new Error("Reference code not returned from server");
      }

      setRefCode(refData.ref_code);
      setError(null); // Clear any previous errors on success
    } catch (err) {
      console.error("Error:", err);
      setError(err instanceof Error ? err.message : "Failed to load contract");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRecordDeposit = async (sig: string, ref: string, retries = 5) => {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`📝 Recording deposit (attempt ${attempt}/${retries})`);
        console.log(`   Signature: ${sig}`);
        console.log(`   RefCode: ${ref}`);
        
        const recordResponse = await fetch(`/api/contracts/${params.id}/record-deposit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            signature: sig,
            refCode: ref,
          }),
        });

        const recordData = await recordResponse.json();
        console.log(`   Response (${recordResponse.status}):`, recordData);
        
        if (!recordResponse.ok) {
          // If transaction not found and we have retries left, wait longer and try again
          if (recordData.error?.includes("not found") && attempt < retries) {
            const waitTime = 5000; // Wait 5 seconds between retries
            console.log(`   ⏳ Transaction not confirmed yet, waiting ${waitTime/1000}s before retry...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          }
          
          setError(`Failed to record: ${recordData.error}`);
          return false;
        } else {
          console.log("✅ Deposit recorded successfully!");
          setError(null);
          
          // Redirect after a short delay
          setTimeout(() => {
            router.push(`/contracts/${params.id}`);
          }, 2000);
          return true;
        }
      } catch (error) {
        console.error(`❌ Error recording deposit (attempt ${attempt}/${retries}):`, error);
        
        // If we have retries left, wait and try again
        if (attempt < retries) {
          console.log(`   ⏳ Waiting 5 seconds before retry...`);
          await new Promise(resolve => setTimeout(resolve, 5000));
          continue;
        }
        
        setError("Failed to record deposit after multiple attempts. The transaction may still be processing.");
        return false;
      }
    }
    
    return false;
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

    if (!refCode || !contract) {
      setError("Missing reference code or contract details");
      return;
    }

    setIsDepositing(true);
    setError(null);

    try {
      const result = await depositToTreasury({
        wallet,
        connection,
        treasuryAddress,
        amount: contract.contract_amount,
        refCode,
      });

      if (result.success) {
        setSuccess(true);
        setTxSignature(result.signature);
        
        console.log("✅ Transaction confirmed! Waiting 8 seconds before recording deposit...");
        
        // Wait longer for the transaction to propagate through the network
        await new Promise(resolve => setTimeout(resolve, 8000));
        
        // Record the deposit directly via API with retries
        const recorded = await handleRecordDeposit(result.signature, refCode, 5);
        if (!recorded) {
          // Show success but with error message
          console.warn("Deposit transaction was successful but recording failed");
          setSuccess(true);
        }
      } else {
        setError(result.error || "Failed to deposit");
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
          <Link
            href="/"
            className="text-blue-600 hover:underline"
          >
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
            <p className="text-gray-600 mb-4">
              Your deposit has been recorded successfully! You will be redirected shortly...
            </p>
            {error && txSignature && refCode && (
              <div className="mb-4">
                <p className="text-red-600 text-sm mb-2">{error}</p>
                <button
                  onClick={() => handleRecordDeposit(txSignature, refCode)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm"
                >
                  Retry Recording Deposit
                </button>
              </div>
            )}
            {txSignature && (
              <a
                href={`https://explorer.solana.com/tx/${txSignature}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline text-sm"
              >
                View transaction on Solana Explorer →
              </a>
            )}
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
                <div className="flex justify-between">
                  <span className="text-gray-600">Reference Code:</span>
                  <span className="font-mono text-sm text-gray-900">
                    {refCode}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
              <div className="flex">
                <svg
                  className="w-5 h-5 text-yellow-600 mr-2 flex-shrink-0 mt-0.5"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
                <div>
                  <h4 className="font-semibold text-yellow-900 mb-1">
                    Important
                  </h4>
                  <p className="text-sm text-yellow-800">
                    The deposit will include a memo with your reference code to
                    link the funds to this contract. This process is automatic
                    and secure.
                  </p>
                </div>
              </div>
            </div>

            {error && !refCode && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
                {error}
              </div>
            )}
            
            {error && refCode && (
              <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 px-4 py-3 rounded mb-4">
                <p className="text-sm">
                  Note: Reference code was generated successfully. You can proceed with the deposit.
                </p>
              </div>
            )}

            <button
              onClick={handleDeposit}
              disabled={isDepositing || !wallet.connected}
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

