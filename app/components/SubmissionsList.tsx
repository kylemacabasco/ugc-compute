"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Submission {
  id: string;
  video_url: string;
  status: string;
  view_count: number;
  notes?: string;
  created_at: string;
  user: {
    wallet_address: string;
    username?: string;
  };
}

interface SubmissionsListProps {
  contractId: string;
}

export default function SubmissionsList({ contractId }: SubmissionsListProps) {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchSubmissions();
  }, [contractId]);

  const fetchSubmissions = async () => {
    try {
      const response = await fetch(`/api/contracts/${contractId}/submissions`);
      if (response.ok) {
        const data = await response.json();
        setSubmissions(data);
      }
    } catch (error) {
      console.error("Error fetching submissions:", error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow p-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Submissions</h2>
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-8">
      <h2 className="text-2xl font-bold text-gray-900 mb-4">
        Submissions ({submissions.length})
      </h2>

      {submissions.length === 0 ? (
        <p className="text-gray-600 text-center py-8">
          No submissions yet. Be the first to submit content!
        </p>
      ) : (
        <div className="space-y-4">
          {submissions.map((submission) => (
            <div
              key={submission.id}
              className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {submission.user.username ||
                      `${submission.user.wallet_address.slice(0, 4)}...${submission.user.wallet_address.slice(-4)}`}
                  </p>
                  <p className="text-xs text-gray-500">
                    {new Date(submission.created_at).toLocaleDateString()}
                  </p>
                </div>
                <span
                  className={`px-3 py-1 text-xs font-medium rounded-full ${
                    submission.status === "approved"
                      ? "bg-green-100 text-green-800"
                      : submission.status === "pending"
                        ? "bg-yellow-100 text-yellow-800"
                        : "bg-red-100 text-red-800"
                  }`}
                >
                  {submission.status}
                </span>
              </div>

              <a
                href={submission.video_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline text-sm block mb-2"
              >
                View Video →
              </a>

              <div className="flex items-center justify-between text-sm text-gray-600">
                <span>{submission.view_count.toLocaleString()} views</span>
                {submission.notes && (
                  <span className="text-xs text-gray-500 italic max-w-md truncate">
                    {submission.notes}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

