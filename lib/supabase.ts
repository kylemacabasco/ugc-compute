import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing Supabase environment configuration");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Helper function for server-side operations
export const createSupabaseServiceClient = () => {
  if (typeof window !== "undefined") {
    throw new Error(
      "createSupabaseServiceClient is only available server-side"
    );
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error("Missing env.SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(supabaseUrl, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
};

// Database types
export interface User {
  id: string;
  wallet_address: string;
  solana_wallet_address?: string | null;
  payout_contact?: string | null;
  username?: string;
  last_wallet_validation_at?: string | null;
  created_at: string;
  updated_at: string;
}
