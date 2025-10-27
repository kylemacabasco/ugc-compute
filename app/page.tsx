"use client";

import WalletButton from "./components/WalletButton";
import UsernameForm from "./components/UsernameForm";
import UserProfile from "./components/UserProfile";
import { useAuth } from "@/app/providers/AuthProvider";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { contracts } from "./data/contracts";
import { useState } from "react";
import ContractCard from "./components/ContractCard";

export default function Home() {
  const { connected } = useWallet();
  const { user, loading } = useAuth();
  const [showProfile, setShowProfile] = useState(false);
  const [selectedContract, setSelectedContract] = useState<number | null>(null);
  const [platform, setPlatform] = useState("youtube");
  const [url, setUrl] = useState("");

  const handleClaimContract = (contractId: number) => {
    setSelectedContract(contractId);
    setUrl("");
    setPlatform("youtube");
  };

  const handleSubmit = () => {
    const contract = contracts.find((c) => c.id === selectedContract);
    if (contract && url) {
      alert(`Submitted!\nContract: ${contract.name}\nPlatform: ${platform}\nURL: ${url}`);
      setSelectedContract(null);
      setUrl("");
    }
  };

  const handleCalculate = () => {
    const contract = contracts.find((c) => c.id === selectedContract);
    if (contract && url) {
      // Mock calculation - in real app you'd fetch actual view count
      const mockViews = Math.floor(Math.random() * 100000) + 1000;
      const earnings = (mockViews / 1000) * contract.ratePer1kViews;
      alert(`Estimated Earnings:\nViews: ${mockViews.toLocaleString()}\nEarnings: $${earnings.toFixed(2)}`);
    }
  };

  // Show loading state
  if (connected && loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-slate-600 dark:text-slate-400">Loading…</p>
        </div>
      </div>
    );
  }

  // Show wallet connection if not connected
  if (!connected) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-slate-900 dark:text-slate-100 mb-4">
            UGC Contracts
          </h1>
          <p className="text-slate-600 dark:text-slate-400 text-lg">
            Connect your wallet to get started
          </p>
        </div>
        <WalletButton />
      </div>
    );
  }

  // Show username form for first-time users without username
  if (user && !user.username && !showProfile) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-4">
        <UsernameForm 
          isFirstTime={true} 
          onComplete={() => {}} // Username created - user.username will be set, so they go to contract page
          onSkip={() => setShowProfile(true)} // Skipped - go to profile page
        />
      </div>
    );
  }

  // Show profile or main app interface
  if (showProfile) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
        {/* Header with back button */}
        <header className="border-b border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-950/50 backdrop-blur-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center h-16">
              <button
                onClick={() => setShowProfile(false)}
                className="flex items-center text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
              >
                ← Back to Home
              </button>
              <h1 className="ml-4 text-xl font-semibold text-slate-900 dark:text-slate-100">Profile</h1>
            </div>
          </div>
        </header>

        {/* Profile content */}
        <div className="flex items-center justify-center py-8 px-4">
          <UserProfile />
        </div>
      </div>
    );
  }

  // Main app interface for authenticated users - Contract Display
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      {/* Header */}
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-950/50 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-4xl font-bold text-slate-900 dark:text-slate-100">
                UGC Contracts
              </h1>
              <p className="mt-2 text-slate-600 dark:text-slate-400">
                Browse available contracts and start earning today
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right mr-2">
                <span className="text-sm text-slate-600 dark:text-slate-400 block">
                  {user?.username}
                </span>
              </div>
              <WalletMultiButton className="!text-xs !py-2 !px-3" />
              <button
                onClick={() => setShowProfile(true)}
                className="bg-blue-600 dark:bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors text-sm font-medium"
              >
                Profile
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {contracts.map((contract) => (
            <ContractCard
              key={contract.id}
              contract={contract}
              onClaim={handleClaimContract}
            />
          ))}
        </div>
      </main>

      {/* Claim Contract Modal */}
      {selectedContract && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-800">
            <div className="flex justify-between items-start mb-6">
              <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                Claim Contract
              </h2>
              <button
                onClick={() => setSelectedContract(null)}
                className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 text-2xl"
              >
                ×
              </button>
            </div>

            <div className="mb-4">
              <p className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-2">
                {contracts.find((c) => c.id === selectedContract)?.name}
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {contracts.find((c) => c.id === selectedContract)?.description}
              </p>
            </div>

            <div className="space-y-4">
              {/* Platform Dropdown */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Platform
                </label>
                <select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                  className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="youtube">YouTube</option>
                </select>
              </div>

              {/* URL Input */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Content URL
                </label>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {/* Buttons */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleCalculate}
                  disabled={!url}
                  className="flex-1 bg-blue-600 dark:bg-blue-500 text-white font-semibold py-3 px-6 rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Calculate
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={!url}
                  className="flex-1 bg-emerald-600 dark:bg-emerald-500 text-white font-semibold py-3 px-6 rounded-lg hover:bg-emerald-700 dark:hover:bg-emerald-600 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Submit
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
