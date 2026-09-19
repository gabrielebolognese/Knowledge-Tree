import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Both values are baked in at build time, so `.env` must exist before
 * `npm run build`. The anon key is designed to be public: it grants nothing on
 * its own, because row-level security is what actually guards the data.
 */
const URL_ = String(import.meta.env["VITE_SUPABASE_URL"] ?? "").trim();
const ANON_KEY = String(import.meta.env["VITE_SUPABASE_ANON_KEY"] ?? "").trim();

export const TREES_TABLE = "trees";
export const PROFILES_TABLE = "profiles";
export const IMAGE_BUCKET = "tree-images";

let client: SupabaseClient | null = null;

/** False when no credentials were provided: the app then runs local-only. */
export function isConfigured(): boolean {
  return URL_ !== "" && ANON_KEY !== "";
}

export function supabase(): SupabaseClient | null {
  if (!isConfigured()) return null;
  client ??= createClient(URL_, ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Completes the magic-link round trip when the email link lands back here.
      detectSessionInUrl: true,
    },
  });
  return client;
}
