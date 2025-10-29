"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/app/providers/AuthProvider";
import SubmissionForm from "@/app/components/SubmissionForm";
import SubmissionsList from "@/app/components/SubmissionsList";

interface Contract {
  id: string;
  title: string;
  description: string;
  contract_amount: number;
  rate_per_1k_views: number;
  status: string;
  calculated_earned: number;
  progress_percentage: number;
  total_submission_views: number;
  is_completed: boolean;
  created_at: string;
  creator_id: string;
  creator?: {
    wallet_address: string;
  };
  metadata?: {
    requirements?: string;
  };
}

export default function ContractDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const [contract, setContract] = useState<Contract | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUpdatingViews, setIsUpdatingViews] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  const [submissionsRefreshKey, setSubmissionsRefreshKey] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    if (params.id) {
      fetchContract();
    }
  }, [params.id]);

  const fetchContract = async () => {
    try {
      const response = await fetch("/api/contracts", {
        cache: 'no-store' // Prevent caching to always get fresh data
      });
      if (!response.ok) {
        throw new Error("Failed to fetch contracts");
      }
      
      const contracts = await response.json();
      const foundContract = contracts.find((c: Contract) => c.id === params.id);
      
      if (!foundContract) {
        setError("Contract not found");
      } else {
        setContract(foundContract);
      }
    } catch (err) {
      console.error("Error fetching contract:", err);
      setError("Failed to load contract");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmissionSuccess = () => {
    fetchContract();
    setSubmissionsRefreshKey((prev) => prev + 1);
  };

  const handleUpdateViews = async () => {
    if (!contract || !user) return;

    setIsUpdatingViews(true);
    setUpdateMessage(null);

    try {
      const response = await fetch(
        `/api/contracts/${contract.id}/update-views`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updater_wallet: user.wallet_address }),
        }
      );

      const data = await response.json();

      if (response.ok) {
        setUpdateMessage(data.message || "Views updated successfully");
        fetchContract();
        setSubmissionsRefreshKey((prev) => prev + 1);
      } else {
        setUpdateMessage(data.error || "Failed to update views");
      }
    } catch (error) {
      console.error("Error updating views:", error);
      setUpdateMessage("Failed to update views");
    } finally {
      setIsUpdatingViews(false);
      setTimeout(() => setUpdateMessage(null), 5000);
    }
  };

  const handleDeleteContract = async () => {
    if (!contract || !user) return;

    setIsDeleting(true);

    try {
      const response = await fetch(`/api/contracts/${contract.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });

      const data = await response.json();

      if (response.ok) {
        // Redirect to home after successful deletion
        router.push("/");
      } else {
        alert(data.error || "Failed to delete contract");
      }
    } catch (error) {
      console.error("Error deleting contract:", error);
      alert("Failed to delete contract");
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const isCreator = user && contract?.creator?.wallet_address === user.wallet_address;
  const canDelete = isCreator && contract?.status === "awaiting_funding";

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error || !contract) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error || "Contract not found"}</p>
          <Link
            href="/contracts"
            className="text-blue-600 hover:underline"
          >
            ← Back to Contracts
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Back Button */}
        <Link
          href="/"
          className="inline-flex items-center text-gray-600 hover:text-gray-900 mb-6"
        >
          ← Back to Home
        </Link>

        {/* Contract Header */}
        <div className="bg-white rounded-lg shadow p-8 mb-6">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">
                {contract.title}
              </h1>
              <span
                className={`inline-block px-3 py-1 text-sm font-medium rounded-full ${
                  contract.is_completed
                    ? "bg-green-100 text-green-800"
                    : contract.status === "awaiting_funding"
                    ? "bg-yellow-100 text-yellow-800"
                    : contract.status === "open"
                    ? "bg-green-100 text-green-800"
                    : contract.status === "awaiting_funding"
                    ? "bg-yellow-100 text-yellow-800"
                    : "bg-blue-100 text-blue-800"
                }`}
              >
                {contract.is_completed ? "Completed" : contract.status.replace(/_/g, " ")}
              </span>
            </div>
            {canDelete && (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="px-4 py-2 text-sm font-medium text-red-600 hover:text-red-700 border border-red-600 rounded-md hover:bg-red-50 transition-colors"
              >
                Delete Contract
              </button>
            )}
          </div>


          <p className="text-gray-600 mb-6">{contract.description}</p>

          {/* Awaiting Funding Warning */}
          {contract.status === "awaiting_funding" && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
              <div className="flex items-start">
                <svg
                  className="w-5 h-5 text-yellow-600 mr-3 flex-shrink-0 mt-0.5"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
                <div className="flex-1">
                  <h4 className="font-semibold text-yellow-900 mb-1">
                    Contract Awaiting Funding
                  </h4>
                  <p className="text-sm text-yellow-800 mb-3">
                    {isCreator
                      ? "This contract needs to be funded before it can accept submissions. Fund it now to make it active."
                      : "This contract is not yet funded and cannot accept submissions."}
                  </p>
                  {user &&
                    contract.creator?.wallet_address === user.wallet_address &&
                    contract.status === "awaiting_funding" && (
                      <Link
                        href={`/contracts/${contract.id}/fund`}
                        className="inline-block px-4 py-2 bg-yellow-600 text-white text-sm font-medium rounded-md hover:bg-yellow-700 transition-colors"
                      >
                        Fund Contract Now
                      </Link>
                  )}
                </div>
              </div>
            </div>
          )}

          {contract.metadata?.requirements && (
            <div className="bg-gray-50 rounded-lg p-4 mb-6">
              <h3 className="font-semibold text-gray-900 mb-2">Requirements</h3>
              <p className="text-gray-700">{contract.metadata.requirements}</p>
            </div>
          )}

          {/* Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-sm text-gray-500 mb-1">Total Amount</p>
              <p className="text-2xl font-bold text-gray-900">
                {contract.contract_amount} SOL
              </p>
            </div>

            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-sm text-gray-500 mb-1">Rate</p>
              <p className="text-2xl font-bold text-gray-900">
                {contract.rate_per_1k_views}
              </p>
              <p className="text-xs text-gray-500">SOL / 1k views</p>
            </div>

            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-sm text-gray-500 mb-1">Earned</p>
              <p className="text-2xl font-bold text-gray-900">
                {contract.calculated_earned.toFixed(2)} SOL
              </p>
            </div>

            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-sm text-gray-500 mb-1">Total Views</p>
              <p className="text-2xl font-bold text-gray-900">
                {contract.total_submission_views.toLocaleString()}
              </p>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="mb-6">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-gray-600">Progress</span>
              <span className="font-semibold text-gray-900">
                {contract.progress_percentage.toFixed(1)}%
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-4">
              <div
                className={`h-4 rounded-full transition-all ${
                  contract.is_completed ? "bg-green-500" : "bg-blue-600"
                }`}
                style={{
                  width: `${Math.min(contract.progress_percentage, 100)}%`,
                }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-2">
              {contract.calculated_earned.toFixed(2)} of {contract.contract_amount} SOL allocated
            </p>
          </div>


          {/* Update Views Button */}
          {!contract.is_completed && contract.status === "open" && (
            <div className="mb-6">
              <button
                onClick={handleUpdateViews}
                disabled={isUpdatingViews}
                className="w-full px-6 py-3 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isUpdatingViews ? "Updating Views..." : "Update View Counts"}
              </button>
              {updateMessage && (
                <p className={`text-sm mt-2 text-center ${updateMessage.includes("success") || updateMessage.includes("Updated") ? "text-green-600" : "text-red-600"}`}>
                  {updateMessage}
                </p>
              )}
            </div>
          )}

          {/* Submission Form */}
          {user && !contract.is_completed && contract.status !== "awaiting_funding" && (
            <div className="border-t pt-6">
              {contract.creator?.wallet_address === user.wallet_address ? (
                <div className="text-center py-4">
                  <p className="text-gray-700 font-medium">Your Contract</p>
                  <p className="text-sm text-gray-500 mt-1">
                    You cannot submit to your own contract
                  </p>
                </div>
              ) : (
                <SubmissionForm contractId={contract.id} onSuccess={handleSubmissionSuccess} />
              )}
            </div>
          )}

          {!user && (
            <div className="border-t pt-6">
              <p className="text-center text-gray-600">
                Connect your wallet to submit content to this contract
              </p>
            </div>
          )}
        </div>

        {/* Submissions Section */}
        <div className="bg-white rounded-lg shadow p-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Submissions</h2>
          <SubmissionsList contractId={contract.id} refreshKey={submissionsRefreshKey} />
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div 
          className="fixed inset-0 bg-gray-50 bg-opacity-90 backdrop-blur-md flex items-center justify-center z-50 p-4"
          onClick={() => setShowDeleteConfirm(false)}
        >
          <div 
            className="bg-white rounded-lg shadow-xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start mb-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <svg
                  className="w-6 h-6 text-red-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>
              <div className="ml-4 flex-1">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Delete Contract
                </h3>
                <p className="text-sm text-gray-600 mb-4">
                  Are you sure you want to delete &quot;{contract.title}&quot;? This action cannot be undone and the contract will be permanently removed.
                </p>
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteContract}
                disabled={isDeleting}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isDeleting ? "Deleting..." : "Delete Contract"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

