import type { createClient } from "@/lib/supabase/server";

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

export async function hasWorkspaceMembership(
  supabase: ServerSupabaseClient,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("join_default_organization");
  if (error) {
    console.error("Could not check workspace membership", {
      code: error.code ?? "database_error",
    });
    throw new Error("Workspace membership could not be checked.");
  }
  return data === true;
}
