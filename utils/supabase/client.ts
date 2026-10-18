import { createBrowserClient } from "@supabase/ssr";

/**
 * Creates a Supabase client for use in browser (Client Components).
 *
 * This function is safe to call from `"use client"` components.
 * It uses the public anon/publishable key, which is safe for the browser
 * because Row Level Security (RLS) policies control data access.
 *
 * Usage:
 * ```ts
 * "use client";
 * import { createClient } from "@/utils/supabase/client";
 *
 * const supabase = createClient();
 * ```
 */
export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Missing Supabase environment variables. " +
        "Ensure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY " +
        "are defined in .env.local. See .env.example for reference."
    );
  }

  return createBrowserClient(supabaseUrl, supabaseKey);
}
