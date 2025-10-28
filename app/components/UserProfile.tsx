"use client";

import React, { useState } from 'react';
import { useAuth } from '@/app/providers/AuthProvider';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import UsernameForm from './UsernameForm';

export default function UserProfile() {
  const [isEditingUsername, setIsEditingUsername] = useState(false);
  const { user, signOut } = useAuth();
  const { disconnect } = useWallet();

  if (!user) {
    return null;
  }

  const handleUsernameComplete = () => {
    setIsEditingUsername(false);
  };

  const handleDisconnectWallet = async () => {
    try {
      await disconnect();
      await signOut();
    } catch (err) {
      console.error('Error disconnecting wallet:', err);
    }
  };

  if (isEditingUsername) {
    return <UsernameForm onComplete={handleUsernameComplete} />;
  }

  return (
    <div className="p-6 bg-white dark:bg-slate-900 rounded-lg shadow-md">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Profile</h2>
        <div className="mt-4 space-y-3">
          <div className="p-3 bg-gray-50 dark:bg-slate-800 rounded-md">
            <p className="text-sm font-medium text-gray-700 dark:text-slate-300">Wallet Address</p>
            <p className="font-mono text-sm text-gray-900 dark:text-slate-100 break-all mt-1">{user.wallet_address}</p>
          </div>

          <div className="p-3 bg-gray-50 dark:bg-slate-800 rounded-md">
            <p className="text-sm font-medium text-gray-700 dark:text-slate-300">Username</p>
            <p className="text-lg font-medium text-gray-900 dark:text-slate-100 mt-1">
              {user.username || <span className="text-gray-500 dark:text-slate-400 italic">No username set</span>}
            </p>
          </div>

          <div className="p-3 bg-gray-50 dark:bg-slate-800 rounded-md">
            <p className="text-sm font-medium text-gray-700 dark:text-slate-300">Member Since</p>
            <p className="text-sm text-gray-900 dark:text-slate-100 mt-1">
              {new Date(user.created_at).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              })}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <button
          onClick={() => setIsEditingUsername(true)}
          className="w-full py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
        >
          {user.username ? 'Change Username' : 'Set Username'}
        </button>

        <div className="border-t border-gray-200 dark:border-slate-700 pt-3">
          <p className="text-sm text-gray-600 dark:text-slate-400 mb-3">Wallet Management</p>

          {/* Wallet Switch Button */}
          <div className="mb-3">
            <WalletMultiButton className="!w-full !bg-purple-600 hover:!bg-purple-700" />
          </div>

          <button
            onClick={handleDisconnectWallet}
            className="w-full py-2 px-4 bg-red-600 text-white rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-colors"
          >
            Disconnect Wallet
          </button>
        </div>

      </div>

      <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md">
        <p className="text-sm text-blue-800 dark:text-blue-200">
          <strong>Coming Soon:</strong> Transaction signing verification for username changes to ensure wallet ownership.
        </p>
      </div>
    </div>
  );
}