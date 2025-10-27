import { Contract } from "../data/contracts";
import Link from "next/link";

interface ContractCardProps {
  contract: Contract;
  onClaim: (bountyId: number) => void;
}

export default function contractCard({ contract, onClaim }: ContractCardProps) {
  const progressPercentage = (contract.claimedContract / contract.totalContract) * 100;
  const remainingContract = contract.totalContract - contract.claimedContract;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 overflow-hidden border border-slate-200 dark:border-slate-800 hover:scale-105 flex flex-col h-full">
      <div className="p-6 flex flex-col flex-grow">
        {/* contract Name */}
        <Link href={`/contract/${contract.id}`}>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-3 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer">
            {contract.name}
          </h2>
        </Link>

        {/* Total contract and Rate */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex flex-col">
            <span className="text-sm text-slate-500 dark:text-slate-400">
              Total Contract
            </span>
            <span className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">
              ${contract.totalContract.toLocaleString()}
            </span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-sm text-slate-500 dark:text-slate-400">
              Rate
            </span>
            <span className="text-xl font-semibold text-blue-600 dark:text-blue-400">
              ${contract.ratePer1kViews}/1k views
            </span>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mb-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Progress
            </span>
            <span className="text-sm text-slate-600 dark:text-slate-400">
              ${remainingContract.toLocaleString()} remaining
            </span>
          </div>
          <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-3 overflow-hidden">
            <div
              className="bg-gradient-to-r from-emerald-500 to-emerald-600 h-full rounded-full transition-all duration-500 ease-out"
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
          <div className="flex justify-between items-center mt-1">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              ${contract.claimedContract.toLocaleString()} claimed
            </span>
            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              {progressPercentage.toFixed(0)}%
            </span>
          </div>
        </div>

        {/* Description */}
        <p className="text-slate-600 dark:text-slate-300 mb-6 flex-grow">
          {contract.description}
        </p>

        {/* CTA Button */}
        <button
          onClick={() => onClaim(contract.id)}
          className="w-full bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-semibold py-3 px-6 rounded-lg hover:bg-slate-800 dark:hover:bg-slate-200 transition-colors duration-200 mt-auto"
        >
          Claim Contract
        </button>
      </div>
    </div>
  );
}
