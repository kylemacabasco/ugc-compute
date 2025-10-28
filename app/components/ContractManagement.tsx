"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/app/providers/AuthProvider";
import Link from "next/link";

interface ContractSummary {
  id: string;
  title: string;
  status: string;
  contract_amount: number;
  progress_percentage: number;
  calculated_earned: number;
  is_completed: boolean;
  created_at: string;
}

interface SubmissionSummary {
  id: string;
  video_url: string;
  status: string;
  view_count: number;
  created_at: string;
  contract_id: string;
  contract: {
    id: string;
    title: string;
  };
}

export default function ContractManagement() {
  const { user } = useAuth();
  const [createdContracts, setCreatedContracts] = useState<ContractSummary[]>([]);
  const [submissions, setSubmissions] = useState<SubmissionSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"created" | "submitted">("created");

  const fetchUserContracts = useCallback(async () => {
    if (!user?.id) return;
    
    try {
      setIsLoading(true);
      
      // Fetch all contracts and user submissions in parallel
      const [contractsRes, submissionsRes] = await Promise.all([
        fetch("/api/contracts"),
        fetch(`/api/submissions?user_id=${user.id}`)
      ]);
      
      const allContracts = await contractsRes.json();
      const userSubmissions = await submissionsRes.json();
      
      // Filter contracts created by the user
      const userCreated = allContracts.filter(
        (c: any) => c.creator_id === user?.id
      );
      
      setCreatedContracts(userCreated);
      setSubmissions(userSubmissions);
    } catch (error) {
      console.error("Error fetching user contracts:", error);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchUserContracts();
  }, [fetchUserContracts]);

  const getStatusBadge = (status: string, isCompleted?: boolean) => {
    if (isCompleted) {
      return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
    }
    
    switch (status) {
      case "open":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400";
      case "approved":
        return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
      case "pending":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400";
      case "rejected":
        return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400";
      case "awaiting_funding":
        return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400";
    }
  };

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-4">
          Contract Management
        </h3>
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
      <div className="p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-4">
          Contract Management
        </h3>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-slate-700 mb-4">
          <button
            onClick={() => setActiveTab("created")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "created"
                ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-300"
            }`}
          >
            Created ({createdContracts.length})
          </button>
          <button
            onClick={() => setActiveTab("submitted")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "submitted"
                ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-300"
            }`}
          >
            Submissions ({submissions.length})
          </button>
        </div>

        {/* Content */}
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {activeTab === "created" ? (
            createdContracts.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-500 dark:text-slate-400 mb-4">
                  You haven&apos;t created any contracts yet
                </p>
                <Link
                  href="/contracts/create"
                  className="text-blue-600 dark:text-blue-400 hover:underline text-sm"
                >
                  Create your first contract →
                </Link>
              </div>
            ) : (
              createdContracts.map((contract) => (
                <Link
                  key={contract.id}
                  href={`/contracts/${contract.id}`}
                  className="block p-4 border border-gray-200 dark:border-slate-700 rounded-lg hover:border-blue-500 dark:hover:border-blue-400 transition-colors"
                >
                  <div className="flex justify-between items-start mb-2">
                    <h4 className="font-medium text-gray-900 dark:text-slate-100">
                      {contract.title}
                    </h4>
                    <span
                      className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusBadge(
                        contract.status,
                        contract.is_completed
                      )}`}
                    >
                      {contract.is_completed ? "Completed" : contract.status}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-gray-600 dark:text-slate-400">
                      {contract.contract_amount} SOL
                    </span>
                    <span className="text-gray-600 dark:text-slate-400">
                      {contract.progress_percentage.toFixed(0)}% complete
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-slate-700 rounded-full h-1.5 mt-2">
                    <div
                      className={`h-1.5 rounded-full ${
                        contract.is_completed ? "bg-green-500" : "bg-blue-600"
                      }`}
                      style={{ width: `${Math.min(contract.progress_percentage, 100)}%` }}
                    />
                  </div>
                </Link>
              ))
            )
          ) : submissions.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500 dark:text-slate-400 mb-4">
                You haven&apos;t submitted to any contracts yet
              </p>
              <Link
                href="/"
                className="text-blue-600 dark:text-blue-400 hover:underline text-sm"
              >
                Browse available contracts →
              </Link>
            </div>
          ) : (
            submissions.map((submission) => (
              <Link
                key={submission.id}
                href={`/contracts/${submission.contract_id}`}
                className="block p-4 border border-gray-200 dark:border-slate-700 rounded-lg hover:border-blue-500 dark:hover:border-blue-400 transition-colors"
              >
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h4 className="font-medium text-gray-900 dark:text-slate-100">
                      {submission.contract.title}
                    </h4>
                    <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                      {(() => {
                        try {
                          return new URL(submission.video_url).hostname;
                        } catch {
                          return submission.video_url;
                        }
                      })()}
                    </p>
                  </div>
                  <span
                    className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusBadge(
                      submission.status
                    )}`}
                  >
                    {submission.status}
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm text-gray-600 dark:text-slate-400">
                  <span>{submission.view_count.toLocaleString()} views</span>
                  <span className="text-xs">
                    {new Date(submission.created_at).toLocaleDateString()}
                  </span>
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

