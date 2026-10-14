"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { can } from "@/lib/auth/roles";
import { getAuthContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const incidentStatus = z.enum(["acknowledged", "investigating", "resolved"]);

export async function changeIncidentStatus(formData: FormData): Promise<void> {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  if (!context.organizationId) redirect("/setup");

  const id = z.string().uuid().safeParse(String(formData.get("incidentId") ?? ""));
  const status = incidentStatus.safeParse(String(formData.get("status") ?? ""));
  if (!id.success || !status.success) redirect("/incidents?error=invalid");
  if (status.data === "resolved" && !can(context.role, "manage_monitoring")) {
    redirect("/incidents?error=forbidden");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_incident_status", {
    p_incident_id: id.data,
    p_status: status.data,
  });
  if (error) {
    console.error("Incident status change failed", { code: error.code });
    redirect("/incidents?error=save");
  }
  redirect("/incidents?success=updated");
}
