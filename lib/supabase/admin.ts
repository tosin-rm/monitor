import { createClient } from "@supabase/supabase-js";
import { publicSupabaseUrl, supabaseSecretKey } from "@/lib/env";

export function createAdminClient() {
  return createClient(publicSupabaseUrl(), supabaseSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
