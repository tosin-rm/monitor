"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { bootstrapOwnerEmail } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const setupSchema = z.object({
  organizationName: z.string().trim().min(1).max(120),
  timeZone: z.string().trim().min(1).max(100),
});

export async function bootstrapOrganization(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user?.email) redirect("/setup?error=unavailable");

  const configuredOwner = bootstrapOwnerEmail();
  if (!configuredOwner || user.email.toLowerCase() !== configuredOwner) {
    redirect("/setup?error=unavailable");
  }

  const parsed = setupSchema.safeParse({
    organizationName: formData.get("organizationName"),
    timeZone: formData.get("timeZone"),
  });
  if (!parsed.success) redirect("/setup?error=invalid");
  if (!isValidTimeZone(parsed.data.timeZone)) redirect("/setup?error=invalid");

  const admin = createAdminClient();
  const { error } = await admin.rpc("bootstrap_first_owner", {
    p_name: parsed.data.organizationName,
    p_timezone: parsed.data.timeZone,
    p_user_id: user.id,
    p_email: user.email.toLowerCase(),
  });
  if (error) {
    console.error("Initial organization bootstrap failed", { code: error.code });
    redirect("/setup?error=unavailable");
  }
  redirect("/");
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}
