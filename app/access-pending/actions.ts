"use server";

import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export async function requestWorkspaceAccess(): Promise<void> {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  if (context.organizationId) redirect("/");

  const supabase = await createClient();
  const { data: status, error } = await supabase.rpc(
    "submit_workspace_access_request",
  );
  if (error) {
    console.error("Workspace access request failed", { code: error.code });
    redirect("/access-pending?error=request");
  }
  redirect(status === "approved" ? "/" : "/access-pending?submitted=1");
}
