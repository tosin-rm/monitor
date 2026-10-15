import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Activity, ArrowLeft, MailPlus, Shield, UserRound, Users } from "lucide-react";
import { changeMemberRole, inviteMember, removeMember } from "@/app/team/actions";
import { ConfirmSubmit } from "@/app/_components/confirm-submit";
import { can, MEMBER_ROLES, parseRole } from "@/lib/auth/roles";
import { getRequestAuthContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Team members" };

export default function TeamPage(props: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  return (
    <Suspense fallback={<TeamLoading />}>
      <TeamContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function TeamContent({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const context = await getRequestAuthContext();
  if (!context) redirect("/login");
  if (!context.organizationId) redirect("/setup");

  const admin = createAdminClient();
  const { error, success } = await searchParams;
  const manageable = can(context.role, "manage_members");
  const owner = context.role === "owner";
  const membersResult = await admin
    .from("organization_members")
    .select("user_id, email, role, created_at")
    .eq("organization_id", context.organizationId)
    .order("created_at", { ascending: true });
  if (membersResult.error) {
    console.error("Team member query failed", { code: membersResult.error.code });
    throw new Error("Team information could not be loaded.");
  }

  let invitations: Array<{ id: string; email: string; role: string; expires_at: string }> = [];
  let auditActivity: Array<{
    id: string;
    actor_user_id: string | null;
    action: string;
    entity_type: string;
    metadata: Record<string, unknown> | null;
    created_at: string;
  }> = [];
  if (manageable) {
    const [invitationsResult, activityResult] = await Promise.all([
      admin.from("invitations").select("id, email, role, expires_at").eq("organization_id", context.organizationId).is("accepted_at", null).is("revoked_at", null).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }),
      admin.from("audit_logs").select("id, actor_user_id, action, entity_type, metadata, created_at").eq("organization_id", context.organizationId).order("created_at", { ascending: false }).limit(10),
    ]);
    if (invitationsResult.error || activityResult.error) {
      console.error("Team administration query failed", [invitationsResult.error?.code, activityResult.error?.code].filter(Boolean));
      throw new Error("Team administration information could not be loaded.");
    }
    invitations = invitationsResult.data ?? [];
    auditActivity = (activityResult.data ?? []).map((entry) => ({
      ...entry,
      metadata: entry.metadata && typeof entry.metadata === "object" && !Array.isArray(entry.metadata)
        ? entry.metadata as Record<string, unknown>
        : null,
    }));
  }

  const members = membersResult.data ?? [];
  const memberById = new Map(members.map((member) => [member.user_id, member.email]));

  return (
    <main className="min-h-screen bg-[#f5f7fa] px-5 py-7 sm:px-8 sm:py-9">
      <div className="mx-auto max-w-5xl">
        <Link href="/" className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-900"><ArrowLeft size={14} /> Back to overview</Link>
        <div className="mt-6 flex items-start gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><Users size={19} /></span>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-950">Team members</h1>
            <p className="mt-1 text-sm text-slate-500">Manage who can access {context.organizationName}.</p>
          </div>
        </div>

        {error && <p role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs leading-5 text-red-700">{teamErrorMessage(error)}</p>}
        {success && <p role="status" className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs leading-5 text-emerald-800">{teamSuccessMessage(success)}</p>}

        <div className="mt-6 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div><h2 className="text-sm font-bold text-slate-900">Members</h2><p className="mt-0.5 text-[11px] text-slate-400">{members.length} people with workspace access</p></div>
              <Users size={16} className="text-slate-400" />
            </div>
            <div className="divide-y divide-slate-100">
              {members.map((member) => {
                const role = parseRole(member.role) ?? "member";
                const canManageTarget = manageable && member.user_id !== context.userId && (owner || role !== "owner");
                return (
                  <div key={member.user_id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600"><UserRound size={16} /></span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-slate-800">{member.email}{member.user_id === context.userId ? " (you)" : ""}</p>
                      <p className="mt-1 text-[10px] text-slate-400">Added {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(member.created_at))}</p>
                    </div>
                    <span className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold capitalize ${role === "owner" ? "bg-violet-50 text-violet-700" : role === "admin" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600"}`}>
                      <Shield size={12} /> {role}
                    </span>
                    {canManageTarget && (
                      <div className="flex items-center gap-2">
                        <form action={changeMemberRole} className="flex items-center gap-1.5">
                          <input type="hidden" name="userId" value={member.user_id} />
                          <label className="sr-only" htmlFor={`role-${member.user_id}`}>Role for {member.email}</label>
                          <select id={`role-${member.user_id}`} name="role" defaultValue={role} className="h-8 rounded-md border border-slate-200 bg-white px-2 text-[11px] text-slate-700">
                            {MEMBER_ROLES.filter((candidate) => candidate !== "owner" || owner).map((candidate) => <option key={candidate} value={candidate}>{candidate}</option>)}
                          </select>
                          <button type="submit" className="h-8 rounded-md border border-slate-200 px-2.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">Save</button>
                        </form>
                        <form action={removeMember}>
                          <input type="hidden" name="userId" value={member.user_id} />
                          <ConfirmSubmit type="submit" confirmation={`Remove ${member.email} from this workspace? They will lose access immediately.`} className="h-8 rounded-md px-2 text-[11px] font-semibold text-red-600 hover:bg-red-50">Remove</ConfirmSubmit>
                        </form>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <div className="space-y-5">
            {manageable && (
              <section className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="flex items-center gap-2"><MailPlus size={16} className="text-blue-600" /><h2 className="text-sm font-bold text-slate-900">Invite a teammate</h2></div>
                <p className="mt-1 text-[11px] leading-5 text-slate-400">They will receive a secure email invitation to set up their account.</p>
                <form action={inviteMember} className="mt-4 space-y-3">
                  <div>
                    <label htmlFor="invite-email" className="mb-1.5 block text-[11px] font-semibold text-slate-700">Email address</label>
                    <input id="invite-email" type="email" name="email" autoComplete="email" required maxLength={254} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" placeholder="teammate@company.com" />
                  </div>
                  <div>
                    <label htmlFor="invite-role" className="mb-1.5 block text-[11px] font-semibold text-slate-700">Role</label>
                    <select id="invite-role" name="role" className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100">
                      <option value="member">Member — operational access</option>
                      {owner && <option value="admin">Admin — manage workspace and team</option>}
                    </select>
                  </div>
                  <button type="submit" className="h-10 w-full rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-700">Send invitation</button>
                </form>
              </section>
            )}

            {manageable && <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-5 py-4"><h2 className="text-sm font-bold text-slate-900">Pending invitations</h2></div>
              {invitations.length ? (
                <div className="divide-y divide-slate-100">
                  {invitations.map((invitation) => (
                    <div key={invitation.id} className="flex items-center justify-between gap-3 px-5 py-3">
                      <div className="min-w-0"><p className="truncate text-xs font-medium text-slate-700">{invitation.email}</p><p className="mt-1 text-[10px] capitalize text-slate-400">{invitation.role}</p></div>
                      <p className="shrink-0 text-[10px] text-slate-400">Expires {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(invitation.expires_at))}</p>
                    </div>
                  ))}
                </div>
              ) : <p className="px-5 py-6 text-xs text-slate-400">No pending invitations.</p>}
            </section>}
          </div>
        </div>

        {can(context.role, "view_audit") && <section className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4"><Activity size={15} className="text-slate-400" /><h2 className="text-sm font-bold text-slate-900">Administrative audit history</h2></div>
          {auditActivity.length ? (
            <div className="divide-y divide-slate-100">
              {auditActivity.map((entry) => (
                <div key={entry.id} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs font-medium text-slate-700">{entry.action.replaceAll(".", " ")}{entry.metadata && "email" in entry.metadata ? ` · ${String(entry.metadata.email)}` : ""}</p>
                  <p className="text-[10px] text-slate-400">{memberById.get(entry.actor_user_id ?? "") ?? "System"} · {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: context.timeZone }).format(new Date(entry.created_at))}</p>
                </div>
              ))}
            </div>
          ) : <p className="px-5 py-6 text-xs text-slate-400">No administrative changes have been recorded yet.</p>}
        </section>}
      </div>
    </main>
  );
}

function teamErrorMessage(error: string): string {
  if (error === "invalid") return "Check the email address and selected role.";
  if (error === "forbidden") return "Your role does not allow team administration.";
  if (error === "invite") return "Invitation email could not be sent. Check Supabase Auth email configuration and the address.";
  if (error === "record_invite") return "The email was invited, but workspace access could not be recorded. Please contact an owner.";
  return "The requested team update could not be completed. Confirm that at least one owner remains.";
}

function teamSuccessMessage(success: string): string {
  if (success === "invited") return "Invitation sent. The teammate can set a password from the invitation email.";
  if (success === "removed") return "Team member access has been removed.";
  return "Team member role has been updated.";
}

function TeamLoading() {
  return <main className="min-h-screen bg-[#f5f7fa] px-5 py-8"><div className="mx-auto max-w-5xl animate-pulse"><div className="h-7 w-40 rounded bg-slate-200" /><div className="mt-7 h-96 rounded-xl border border-slate-200 bg-white" /></div></main>;
}
