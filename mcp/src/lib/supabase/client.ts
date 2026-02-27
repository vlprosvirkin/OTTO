/**
 * Supabase client for MCP server (standalone Node.js)
 * Falls back to a no-op mock when env vars are missing.
 */

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

// No-op mock so tools that don't actually write to DB still load fine
const mockClient = {
  from: () => ({
    select: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }),
    upsert: () => Promise.resolve({ data: null, error: null }),
    insert: () => Promise.resolve({ data: null, error: null }),
  }),
} as unknown as ReturnType<typeof createSupabaseClient>;

export const supabase =
  supabaseUrl && supabaseKey
    ? createSupabaseClient(supabaseUrl, supabaseKey)
    : mockClient;

export function createClient() {
  return supabase;
}
