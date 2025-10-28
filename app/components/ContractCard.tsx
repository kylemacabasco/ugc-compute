import Link from "next/link";

export interface ApiContract {
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
  updated_at: string;
}

interface ContractCardProps {
  contract: ApiContract;
}

export default function ContractCard({ contract }: ContractCardProps) {
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInMs = now.getTime() - date.getTime();
    const diffInHours = diffInMs / (1000 * 60 * 60);
    const diffInDays = diffInHours / 24;

    if (diffInHours < 1) {
      const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
      return `${diffInMinutes}m ago`;
    } else if (diffInHours < 24) {
      return `${Math.floor(diffInHours)}h ago`;
    } else if (diffInDays < 7) {
      return `${Math.floor(diffInDays)}d ago`;
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
  };

  return (
    <Link
      href={`/contracts/${contract.id}`}
      className="bg-white dark:bg-slate-900 rounded-lg shadow hover:shadow-lg transition-shadow p-6 block border border-slate-200 dark:border-slate-800"
    >
      <div className="flex justify-between items-start mb-4">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100">
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

      <p className="text-gray-600 dark:text-slate-400 text-sm mb-4 line-clamp-2">
        {contract.description}
      </p>

      <div className="space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500 dark:text-slate-400">Total Amount:</span>
          <span className="font-semibold text-gray-900 dark:text-slate-100">
            {contract.contract_amount} SOL
          </span>
        </div>

        <div className="flex justify-between text-sm">
          <span className="text-gray-500 dark:text-slate-400">Rate:</span>
          <span className="font-semibold text-gray-900 dark:text-slate-100">
            {contract.rate_per_1k_views} SOL / 1k views
          </span>
        </div>

        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-500 dark:text-slate-400">Progress</span>
            <span className="text-gray-900 dark:text-slate-100">
              {contract.progress_percentage.toFixed(0)}%
            </span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-slate-700 rounded-full h-2">
            <div
              className={`h-2 rounded-full ${
                contract.is_completed ? "bg-green-500" : "bg-blue-600"
              }`}
              style={{ width: `${Math.min(contract.progress_percentage, 100)}%` }}
            />
          </div>
        </div>

        {contract.total_submission_views > 0 && (
          <div className="text-sm text-gray-500 dark:text-slate-400">
            {contract.total_submission_views.toLocaleString()} total views
          </div>
        )}

        <div className="pt-2 mt-2 border-t border-slate-200 dark:border-slate-700 text-xs text-gray-400 dark:text-slate-500">
          Last updated {formatDate(contract.updated_at)}
        </div>
      </div>
    </Link>
  );
}
