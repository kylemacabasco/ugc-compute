"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/app/providers/AuthProvider";

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
}

export default function ContractsPage() {
  const { user } = useAuth();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchContracts();
  }, []);

  const fetchContracts = async () => {
    try {
      const response = await fetch("/api/contracts");
      if (response.ok) {
        const data = await response.json();
        setContracts(data);
      }
    } catch (error) {
      console.error("Error fetching contracts:", error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Contracts</h1>
            <p className="text-gray-600 mt-2">
              Browse and participate in UGC contracts
            </p>
          </div>
          
          {user && (
            <Link
              href="/contracts/create"
              className="px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              Create Contract
            </Link>
          )}
        </div>

        {contracts.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <p className="text-gray-600 mb-4">No contracts yet</p>
            {user && (
              <Link
                href="/contracts/create"
                className="text-blue-600 hover:underline"
              >
                Create the first one →
              </Link>
            )}
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {contracts.map((contract) => (
              <Link
                key={contract.id}
                href={`/contracts/${contract.id}`}
                className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow p-6"
              >
                <div className="flex justify-between items-start mb-4">
                  <h2 className="text-xl font-semibold text-gray-900">
                    {contract.title}
                  </h2>
                  <span
                    className={`px-3 py-1 text-xs font-medium rounded-full ${
                      contract.is_completed
                        ? "bg-green-100 text-green-800"
                        : "bg-blue-100 text-blue-800"
                    }`}
                  >
                    {contract.is_completed ? "Completed" : contract.status}
                  </span>
                </div>

                <p className="text-gray-600 text-sm mb-4 line-clamp-2">
                  {contract.description}
                </p>

                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Total Amount:</span>
                    <span className="font-semibold text-gray-900">
                      {contract.contract_amount} SOL
                    </span>
                  </div>

                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Rate:</span>
                    <span className="font-semibold text-gray-900">
                      {contract.rate_per_1k_views} SOL / 1k views
                    </span>
                  </div>

                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-500">Progress</span>
                      <span className="text-gray-900">
                        {contract.progress_percentage.toFixed(0)}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${
                          contract.is_completed ? "bg-green-500" : "bg-blue-600"
                        }`}
                        style={{ width: `${Math.min(contract.progress_percentage, 100)}%` }}
                      />
                    </div>
                  </div>

                  {contract.total_submission_views > 0 && (
                    <div className="text-sm text-gray-500">
                      {contract.total_submission_views.toLocaleString()} total views
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

