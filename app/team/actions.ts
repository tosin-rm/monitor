"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { can, parseRole } from "@/lib/auth/roles";
import { appBaseUrl } from "@/lib/env";
import { classifyTeamInviteError } from "@/lib/auth/team-invite-error";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthContext } from "@/lib/auth/session";

const emailSchema = z.string().trim().email().max(254);
const requestIdSchema = z.string().uuid();
const invitationIdSchema = z.string().uuid();

export async function reviewWorkspaceAccess(formData: FormData): Promise<void> {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  if (!context.organizationId) redirect("/access-pending");
  if (!can(context.role, "manage_members")) redirect("/team?error=forbidden");

  const requestId = requestIdSchema.safeParse(String(formData.get("requestId") ?? ""));
  const decision = String(formData.get("decision") ?? "");
  if (!requestId.success || (decision !== "approve" && decision !== "reject")) {
    redirect("/team?error=invalid");
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("review_workspace_access_request", {
    p_organization_id: context.organizationId,
    p_actor_user_id: context.userId,
    p_request_id: requestId.data,
    p_approve: decision === "approve",
  });
  if (error) {
    console.error("Workspace access request review failed", { code: error.code });
    redirect("/team?error=access_review");
  }
  redirect(`/team?success=${decision === "approve" ? "access_approved" : "access_rejected"}`);
}

export async function inviteMember(formData: FormData): Promise<void> {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  if (!context.organizationId) redirect("/access-pending");
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
    const category = classifyTeamInviteError(inviteError);
    console.error("Team invitation failed", {
      code: inviteError?.code ?? "missing_user",
      status: inviteError?.status,
      category,
    });
    const error = category === "existing-account"
      ? "invite-existing"
      : category === "rate-limit"
        ? "invite-rate-limit"
        : "invite";
    redirect(`/team?error=${error}`);
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
  if (!context.organizationId) redirect("/access-pending");
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
  if (!context.organizationId) redirect("/access-pending");
  if (!can(context.role, "manage_members")) redirect("/team?error=forbidden");

  const parsedUserId = requestIdSchema.safeParse(String(formData.get("userId") ?? ""));
  if (!parsedUserId.success) redirect("/team?error=invalid");

  const admin = createAdminClient();
  const { error: accessError } = await admin.rpc("prepare_team_member_account_deletion", {
    p_organization_id: context.organizationId,
    p_actor_user_id: context.userId,
    p_target_user_id: parsedUserId.data,
  });
  if (accessError) {
    console.error("Preparing team account deletion failed", { code: accessError.code });
    redirect("/team?error=member_update");
  }
  const { error: deleteError } = await admin.auth.admin.deleteUser(parsedUserId.data);
  if (deleteError) {
    console.error("Team member Auth account deletion failed", {
      code: deleteError.code ?? "auth_error",
    });
    redirect("/team?error=account_delete");
  }
  redirect("/team?success=account_deleted");
}

export async function cancelInvitation(formData: FormData): Promise<void> {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  if (!context.organizationId) redirect("/access-pending");
  if (!can(context.role, "manage_members")) redirect("/team?error=forbidden");

  const invitationId = invitationIdSchema.safeParse(
    String(formData.get("invitationId") ?? ""),
  );
  if (!invitationId.success) redirect("/team?error=invalid");

  const admin = createAdminClient();
  const { data: userId, error: prepareError } = await admin.rpc(
    "prepare_pending_invitation_account_deletion",
    {
      p_organization_id: context.organizationId,
      p_actor_user_id: context.userId,
      p_invitation_id: invitationId.data,
    },
  );
  if (prepareError) {
    console.error("Preparing invitation cancellation failed", {
      code: prepareError.code,
    });
    redirect("/team?error=invitation_cancel");
  }

  if (userId) {
    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) {
      console.error("Invited Auth account deletion failed", {
        code: deleteError.code ?? "auth_error",
      });
      redirect("/team?error=account_delete");
    }
  }
  redirect("/team?success=invitation_cancelled");
}
