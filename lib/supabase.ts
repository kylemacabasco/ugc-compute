import { createBrowserClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment configuration')
}

// Browser client for client-side operations
export const createSupabaseBrowserClient = () =>
  createBrowserClient(supabaseUrl, supabaseAnonKey)

// Service-role client for server-side/CLI scripts
export const createSupabaseServiceClient = () => {
  if (typeof window !== 'undefined') {
    throw new Error('createSupabaseServiceClient is only available server-side')
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) {
    throw new Error('Missing env.SUPABASE_SERVICE_ROLE_KEY')
  }

  return createClient(supabaseUrl, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function ensureEnv(keys: readonly string[]): void {
  const missing = keys.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

// Database types
export interface User {
  id: string
  wallet_address: string
  solana_wallet_address?: string | null
  payout_contact?: string | null
  username?: string
  last_wallet_validation_at?: string | null
  created_at: string
  updated_at: string
}
