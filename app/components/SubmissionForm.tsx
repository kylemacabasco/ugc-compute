"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";

// Extend Window interface for Phantom wallet
declare global {
  interface Window {
    phantom?: {
      solana?: {
        signMessage: (
          message: Uint8Array,
          encoding: string
        ) => Promise<{ signature: Uint8Array }>;
      };
    };
    solana?: {
      signMessage: (
        message: Uint8Array,
        encoding: string
      ) => Promise<{ signature: Uint8Array }>;
    };
  }
}

interface SubmissionFormProps {
  contractId: string;
  onSuccess?: () => void;
}

export default function SubmissionForm({
  contractId,
  onSuccess,
}: SubmissionFormProps) {
  const { publicKey } = useWallet();
  const [videoUrl, setVideoUrl] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<{
    valid: boolean;
    explanation: string;
  } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!publicKey) {
      setError("Please connect your wallet to submit content");
      return;
    }

    if (!videoUrl) {
      setError("Please enter a video URL");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setValidationResult(null);

    try {
      // Sign message to prove wallet ownership
      const timestamp = Date.now();
      const message = `Submit content to contract\n\nContract ID: ${contractId}\nVideo URL: ${videoUrl}\nWallet: ${publicKey.toBase58()}\nTimestamp: ${timestamp}`;

      const messageBytes = new TextEncoder().encode(message);

      // Request wallet signature
      const wallet = window.phantom?.solana || window.solana;
      if (!wallet || !wallet.signMessage) {
        throw new Error("Wallet does not support message signing");
      }

      const { signature } = await wallet.signMessage(messageBytes, "utf8");
      const signatureBase58 = bs58.encode(signature);

      const response = await fetch(`/api/contracts/${contractId}/submissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          video_url: videoUrl,
          submitter_wallet: publicKey.toBase58(),
          signature: signatureBase58,
          message,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to submit content");
      }

      if (data.valid) {
        // Success!
        setValidationResult({
          valid: true,
          explanation: data.explanation,
        });
        setVideoUrl("");
        if (onSuccess) {
          onSuccess();
        }
      } else {
        // Validation failed
        setValidationResult({
          valid: false,
          explanation: data.explanation,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit content");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-2xl font-bold text-gray-900 mb-4">
        Submit Your Content
      </h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            YouTube Video URL
          </label>
          <input
            type="url"
            required
            className="w-full border border-gray-300 rounded-md px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 placeholder:text-gray-500"
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            placeholder="https://youtube.com/watch?v=…"
            disabled={isSubmitting}
          />
          <p className="text-sm text-gray-500 mt-1">
            Your video will be validated by AI to ensure it meets the contract
            requirements
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {validationResult && (
          <div
            className={`border px-4 py-3 rounded ${
              validationResult.valid
                ? "bg-green-50 border-green-200 text-green-700"
                : "bg-yellow-50 border-yellow-200 text-yellow-700"
            }`}
          >
            <p className="font-semibold mb-2">
              {validationResult.valid
                ? "✅ Submission Approved!"
                : "❌ Submission Needs Improvement"}
            </p>
            <p className="text-sm">{validationResult.explanation}</p>
          </div>
        )}

        {!publicKey ? (
          <p className="text-gray-600 text-center py-2">
            Connect your wallet to submit content
          </p>
        ) : (
          <button
            type="submit"
            disabled={isSubmitting || !videoUrl}
            className="w-full px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? "Validating…" : "Submit Content"}
          </button>
        )}
      </form>

      <div className="mt-4 text-sm text-gray-500">
        <p className="font-semibold mb-2">Submission Process:</p>
        <ol className="list-decimal list-inside space-y-1">
          <li>Paste your YouTube video URL</li>
          <li>AI validates your content meets requirements</li>
          <li>Approved videos are added to the contract</li>
          <li>Earn based on your video's view count</li>
        </ol>
      </div>
    </div>
  );
}
