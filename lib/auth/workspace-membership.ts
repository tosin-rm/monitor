import type { createClient } from "@/lib/supabase/server";

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

export async function ensureDefaultWorkspaceMembership(
  supabase: ServerSupabaseClient,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("join_default_organization");
  if (error) {
    console.error("Could not attach account to the workspace", {
      code: error.code ?? "database_error",
    });
    return false;
  }
  return data === true;
}
