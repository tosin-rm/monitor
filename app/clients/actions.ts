"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { can } from "@/lib/auth/roles";
import { getAuthContext } from "@/lib/auth/session";
import { LIFECYCLE_STATUSES } from "@/lib/lifecycle/status";
import { createClient } from "@/lib/supabase/server";

const optionalText = (max: number) =>
  z.string().trim().max(max).transform((value) => value || null);
const clientSchema = z.object({
  name: z.string().trim().min(1).max(160),
  contactName: optionalText(160),
  contactEmail: z.union([z.string().trim().email().max(254), z.literal("")]).transform((value) => value || null),
  contactPhone: optionalText(80),
  notes: optionalText(4000),
});

function readClientForm(formData: FormData) {
  return clientSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    contactName: String(formData.get("contactName") ?? ""),
    contactEmail: String(formData.get("contactEmail") ?? ""),
    contactPhone: String(formData.get("contactPhone") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  });
}

export async function createClientRecord(formData: FormData): Promise<void> {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  if (!context.organizationId) redirect("/setup");
  if (!can(context.role, "manage_clients")) redirect("/clients?error=forbidden");
  const parsed = readClientForm(formData);
  if (!parsed.success) redirect("/clients?error=invalid");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .insert({
      organization_id: context.organizationId,
      name: parsed.data.name,
      contact_name: parsed.data.contactName,
      contact_email: parsed.data.contactEmail,
      contact_phone: parsed.data.contactPhone,
      notes: parsed.data.notes,
    })
    .select("id")
    .single();
  if (error) {
    console.error("Client creation failed", { code: error.code });
    redirect("/clients?error=save");
  }
  redirect(`/clients/${data.id}`);
}

export async function updateClientRecord(formData: FormData): Promise<void> {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  if (!context.organizationId) redirect("/setup");
  if (!can(context.role, "manage_clients")) redirect("/clients?error=forbidden");
  const clientId = String(formData.get("clientId") ?? "");
  const parsed = readClientForm(formData);
  if (!clientId || !parsed.success) redirect("/clients?error=invalid");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .update({
      name: parsed.data.name,
      contact_name: parsed.data.contactName,
      contact_email: parsed.data.contactEmail,
      contact_phone: parsed.data.contactPhone,
      notes: parsed.data.notes,
    })
    .eq("id", clientId)
    .eq("organization_id", context.organizationId)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    console.error("Client update failed", { code: error?.code ?? "not_found" });
    redirect(`/clients/${clientId}?error=save`);
  }
  redirect(`/clients/${clientId}?success=saved`);
}

export async function updateClientLifecycle(formData: FormData): Promise<void> {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  if (!context.organizationId) redirect("/setup");
  if (!can(context.role, "manage_clients")) redirect("/clients?error=forbidden");
  const clientId = String(formData.get("clientId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!z.string().uuid().safeParse(clientId).success || !LIFECYCLE_STATUSES.includes(status as (typeof LIFECYCLE_STATUSES)[number])) {
    redirect("/clients?error=invalid");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .update({ lifecycle_status: status, active: status === "active" })
    .eq("id", clientId)
    .eq("organization_id", context.organizationId)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    console.error("Client lifecycle update failed", { code: error?.code ?? "not_found" });
    redirect(`/clients/${clientId}?error=lifecycle`);
  }
  redirect(`/clients/${clientId}?success=lifecycle`);
}
