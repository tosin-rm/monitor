"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { can, parseRole } from "@/lib/auth/roles";
import { appBaseUrl } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthContext } from "@/lib/auth/session";

const emailSchema = z.string().trim().email().max(254);

export async function inviteMember(formData: FormData): Promise<void> {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  if (!context.organizationId) redirect("/setup");
  if (!can(context.role, "manage_members")) redirect("/team?error=forbidden");

  const parsedEmail = emailSchema.safeParse(String(formData.get("email") ?? "").toLowerCase());
  const role = parseRole(String(formData.get("role") ?? ""));
  if (!parsedEmail.success || !role || role === "owner" || (role === "admin" && context.role !== "owner")) {
    redirect("/team?error=invalid");
  }

  const admin = createAdminClient();
  const inviteRedirect = new URL("/auth/callback", appBaseUrl());
  inviteRedirect.searchParams.set("next", "/set-password");
  const { data: invitation, error: inviteError } = await admin.auth.admin.inviteUserByEmail(
    parsedEmail.data,
    { redirectTo: inviteRedirect.toString() },
  );
  if (inviteError || !invitation.user) {
    console.error("Team invitation failed", { code: inviteError?.code ?? "missing_user" });
    redirect("/team?error=invite");
  }

  const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const { error } = await admin.rpc("record_team_invitation", {
    p_organization_id: context.organizationId,
    p_actor_user_id: context.userId,
    p_user_id: invitation.user.id,
    p_email: parsedEmail.data,
    p_role: role,
    p_expires_at: expiresAt,
  });
  if (error) {
    console.error("Recording team invitation failed", { code: error.code });
    redirect("/team?error=record_invite");
  }
  redirect("/team?success=invited");
}

export async function changeMemberRole(formData: FormData): Promise<void> {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  if (!context.organizationId) redirect("/setup");
  if (!can(context.role, "manage_members")) redirect("/team?error=forbidden");

  const targetUserId = String(formData.get("userId") ?? "");
  const role = parseRole(String(formData.get("role") ?? ""));
  if (!targetUserId || !role || (role === "owner" && context.role !== "owner")) {
    redirect("/team?error=invalid");
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("change_team_member_role", {
    p_organization_id: context.organizationId,
    p_actor_user_id: context.userId,
    p_target_user_id: targetUserId,
    p_role: role,
  });
  if (error) {
    console.error("Team role change failed", { code: error.code });
    redirect("/team?error=member_update");
  }
  redirect("/team?success=updated");
}

export async function removeMember(formData: FormData): Promise<void> {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  if (!context.organizationId) redirect("/setup");
  if (!can(context.role, "manage_members")) redirect("/team?error=forbidden");

  const targetUserId = String(formData.get("userId") ?? "");
  if (!targetUserId) redirect("/team?error=invalid");

  const admin = createAdminClient();
  const { error } = await admin.rpc("remove_team_member", {
    p_organization_id: context.organizationId,
    p_actor_user_id: context.userId,
    p_target_user_id: targetUserId,
  });
  if (error) {
    console.error("Team member removal failed", { code: error.code });
    redirect("/team?error=member_update");
  }
  redirect("/team?success=removed");
}
