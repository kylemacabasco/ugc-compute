"use client";

import Link from "next/link";
import UserProfile from "@/app/components/UserProfile";
import UsernameForm from "@/app/components/UsernameForm";
import ContractManagement from "@/app/components/ContractManagement";
import { useAuth } from "@/app/providers/AuthProvider";
import { useWallet } from "@solana/wallet-adapter-react";
import { useRouter } from "next/navigation";

export default function ProfilePage() {
  const { user, loading } = useAuth();
  const { connected } = useWallet();
  const router = useRouter();

  // Redirect if not connected
  if (!connected && !loading) {
    router.push("/");
    return null;
  }

  // Show loading state
  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-slate-600 dark:text-slate-400">Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      {/* Header with back button */}
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-950/50 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center h-16">
            <Link
              href="/"
              className="flex items-center text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
            >
              ← Back to Home
            </Link>
            <h1 className="ml-4 text-xl font-semibold text-slate-900 dark:text-slate-100">Profile</h1>
          </div>
        </div>
      </header>

      {/* Profile content */}
      <div className="py-8 px-4">
        {!user?.username ? (
          <div className="max-w-md mx-auto">
            <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                <strong>Create a username</strong> to access contracts and start earning!
              </p>
            </div>
            <UsernameForm 
              isFirstTime={true} 
              onComplete={() => {}} // Username created - stays on profile page
            />
          </div>
        ) : (
          <div className="max-w-5xl mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* User Profile Card - Left side */}
              <div className="lg:col-span-1">
                <UserProfile />
              </div>
              
              {/* Contract Management - Right side */}
              <div className="lg:col-span-2">
                <ContractManagement />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

