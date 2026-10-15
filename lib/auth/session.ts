import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { can, parseRole, type MemberRole, type Permission } from "@/lib/auth/roles";

export type AuthContext = {
  userId: string;
  email: string;
  organizationId: string;
  organizationName: string;
  timeZone: string;
  role: MemberRole;
};

export async function getAuthContext(): Promise<AuthContext | null> {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  const userId = typeof claims?.sub === "string" ? claims.sub : null;
  if (!userId) return null;
  const email =
    typeof claims?.email === "string"
      ? claims.email
      : ((await supabase.auth.getUser()).data.user?.email ?? "");

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role, organization_id, organizations(name, timezone)")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (!membership) {
    return {
      userId,
      email,
      organizationId: "",
      organizationName: "",
      timeZone: "Europe/London",
      role: "member",
    };
  }

  const role = parseRole(membership.role);
  if (!role) return null;
  const organization = Array.isArray(membership.organizations)
    ? membership.organizations[0]
    : membership.organizations;

  return {
    userId,
    email,
    organizationId: membership.organization_id as string,
    organizationName: (organization?.name as string) ?? "Organization",
    timeZone: (organization?.timezone as string) ?? "Europe/London",
    role,
  };
}

export async function getRequestAuthContext(): Promise<AuthContext | null> {
  await connection();
  return getAuthContext();
}

export async function requireAuth(): Promise<AuthContext> {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  if (!context.organizationId) redirect("/setup");
  return context;
}

export async function requireRequestAuth(): Promise<AuthContext> {
  await connection();
  return requireAuth();
}

export function requirePermission(context: AuthContext, permission: Permission) {
  if (!can(context.role, permission)) {
    throw new Error("You do not have permission to perform this action");
  }
}
