"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import WalletButton from "./components/WalletButton";
import UsernameForm from "./components/UsernameForm";
import { useAuth } from "@/app/providers/AuthProvider";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import ContractCard, { ApiContract } from "@/app/components/ContractCard";

export default function HomePage() {
  const router = useRouter();
  const { connected } = useWallet();
  const { user, loading } = useAuth();
  const [contracts, setContracts] = useState<ApiContract[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showUsernameForm, setShowUsernameForm] = useState(false);

  useEffect(() => {
    if (connected && user) {
      fetchContracts();
      // Show username form on first login if no username
      if (!user.username) {
        setShowUsernameForm(true);
      }
    }
  }, [connected, user]);

  // Redirect to profile if user has no username and they're not on the username form
  useEffect(() => {
    if (user && !user.username && !showUsernameForm) {
      router.push("/profile");
    }
  }, [user, showUsernameForm, router]);

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
  if (user && !user.username && showUsernameForm) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-4">
        <UsernameForm 
          isFirstTime={true} 
          onComplete={() => setShowUsernameForm(false)} // Username created - go to contract page
          onSkip={() => router.push("/profile")} // Skipped - redirect to profile page to set username
        />
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
              <Link
                href="/profile"
                className="bg-blue-600 dark:bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors text-sm font-medium"
              >
                Profile
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Create Contract Button */}
        <div className="flex justify-end mb-6">
          <Link
            href="/contracts/create"
            className="bg-blue-600 dark:bg-blue-500 text-white px-6 py-3 rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors font-medium"
          >
            + Create Contract
          </Link>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        ) : contracts.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-12 text-center">
            <p className="text-slate-600 dark:text-slate-400 mb-4">No contracts yet</p>
            {user && (
              <Link
                href="/contracts/create"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                Create the first one →
              </Link>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {contracts.map((contract) => (
              <ContractCard key={contract.id} contract={contract} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
