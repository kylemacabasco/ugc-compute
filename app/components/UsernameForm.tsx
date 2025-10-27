"use client";

import React, { useState } from 'react';
import { useAuth } from '@/app/providers/AuthProvider';
import { useUserProfile } from '@/app/hooks/useUserProfile';

interface UsernameFormProps {
  isFirstTime?: boolean;
  onComplete?: () => void;
  onSkip?: () => void;
}

export default function UsernameForm({ isFirstTime = false, onComplete, onSkip }: UsernameFormProps) {
  const [username, setUsername] = useState('');
  const [isChecking, setIsChecking] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationError, setValidationError] = useState('');
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);
  const [checkError, setCheckError] = useState('');

  const { user } = useAuth();
  const { updateUsername, checkUsernameAvailable, error: profileError, isUpdating } = useUserProfile();

  // Validate username format
  const validateUsername = (value: string): string => {
    const trimmed = value.trim();

    if (!trimmed) {
      return 'Username is required';
    }

    if (trimmed.length < 3) {
      return 'Username must be at least 3 characters long';
    }

    if (trimmed.length > 20) {
      return 'Username must be less than 20 characters long';
    }

    if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
      return 'Username can only contain letters, numbers, and underscores';
    }

    return '';
  };

  // Check username availability with debouncing
  const checkAvailability = async (value: string) => {
    const trimmed = value.trim();

    if (!trimmed || validateUsername(trimmed)) {
      setIsAvailable(null);
      setCheckError('');
      return;
    }

    // Check if this is already their current username
    if (user?.username && user.username.toLowerCase() === trimmed.toLowerCase()) {
      setIsAvailable(false); // Set to false to prevent green checkmark
      setValidationError('This is already your current username');
      setCheckError('');
      return;
    }

    setIsChecking(true);
    setCheckError('');
    try {
      const available = await checkUsernameAvailable(trimmed);
      setIsAvailable(available);
    } catch (err) {
      console.error('Error checking username availability:', err);
      setIsAvailable(null);
      setCheckError('Failed to check username availability. Please try again.');
    } finally {
      setIsChecking(false);
    }
  };

  // Handle username input change
  const handleUsernameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setUsername(value);

    // Only set validation error for format issues, not "already your username"
    const formatError = validateUsername(value);
    setValidationError(formatError);

    // Reset availability check and errors
    setIsAvailable(null);
    setCheckError('');

    // Debounce availability check
    const timeoutId = setTimeout(() => {
      checkAvailability(value);
    }, 500);

    return () => clearTimeout(timeoutId);
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmed = username.trim();
    const validation = validateUsername(trimmed);

    if (validation) {
      setValidationError(validation);
      return;
    }

    if (isAvailable === false) {
      setValidationError('Username is not available');
      return;
    }

    if (isAvailable === null) {
      // Check availability one more time before submitting
      await checkAvailability(trimmed);
      return;
    }

    setIsSubmitting(true);
    try {
      await updateUsername(trimmed);
      onComplete?.();
    } catch (err) {
      // Error is handled by the useUserProfile hook
      console.error('Error updating username:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle skip (only for first-time users)
  const handleSkip = () => {
    if (onSkip) {
      onSkip();
    } else {
      onComplete?.();
    }
  };

  return (
    <div className="max-w-md mx-auto p-6 bg-white rounded-lg shadow-md">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold text-gray-900">
          {isFirstTime ? 'Welcome!' : 'Update Username'}
        </h2>
        <p className="text-gray-600 mt-2">
          {isFirstTime 
            ? 'Choose a username for your account' 
            : 'Change your username'
          }
        </p>
        {user?.wallet_address && (
          <p className="text-sm text-gray-500 mt-1 font-mono">
            {user.wallet_address.slice(0, 8)}…{user.wallet_address.slice(-8)}
          </p>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-2">
            Username
          </label>
          <div className="relative">
            <input
              type="text"
              id="username"
              value={username}
              onChange={handleUsernameChange}
              placeholder="Enter your username"
              className={`w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-gray-900 placeholder-gray-500 ${
                validationError || (isAvailable === false)
                  ? 'border-red-300'
                  : isAvailable === true
                  ? 'border-green-300'
                  : 'border-gray-300'
              } ${isUpdating || isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
              disabled={isUpdating || isSubmitting}
            />
            {isChecking && (
              <div className="absolute right-3 top-2">
                <div className="animate-spin h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full"></div>
              </div>
            )}
            {!isChecking && isAvailable === true && (
              <div className="absolute right-3 top-2 text-green-500">
                ✅
              </div>
            )}
            {!isChecking && isAvailable === false && (
              <div className="absolute right-3 top-2 text-orange-500">
                ❌
              </div>
            )}
          </div>

          {validationError && (
            <p className="text-red-600 text-sm mt-1">{validationError}</p>
          )}

          {!validationError && isAvailable === false && (
            <p className="text-red-600 text-sm mt-1">Username is already taken</p>
          )}

          {!validationError && isAvailable === true && (
            <p className="text-green-600 text-sm mt-1">Username is available!</p>
          )}

          {checkError && (
            <p className="text-orange-600 text-sm mt-1">{checkError}</p>
          )}
          
          {profileError && (
            <p className="text-red-600 text-sm mt-1">{profileError}</p>
          )}
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={isUpdating || !!validationError || isAvailable !== true}
            className={`flex-1 py-2 px-4 rounded-md font-medium transition-colors flex items-center justify-center gap-2 ${
              isUpdating || isSubmitting || !!validationError || isAvailable !== true
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2'
            }`}
          >
            {isUpdating && (
              <div className="animate-spin h-4 w-4 border-2 border-gray-500 border-t-transparent rounded-full"></div>
            )}
            {isUpdating ? 'Verifying & Saving…' : isFirstTime ? 'Create Username' : 'Sign & Update Username'}
          </button>

          {isFirstTime && (
            <button
              type="button"
              onClick={handleSkip}
              disabled={isUpdating || isSubmitting}
              className="px-4 py-2 text-gray-600 hover:text-gray-800 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Skip for now
            </button>
          )}
        </div>
      </form>

      {!isFirstTime && (
        <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
          <p className="text-sm text-yellow-800">
            <strong>Note:</strong> In the future, you&apos;ll need to sign a transaction to verify wallet ownership before changing your username.
          </p>
        </div>
      )}
    </div>
  );
}