"use server";

import { can } from "@/lib/auth/roles";
import { getAuthContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { newPairingCode, sha256 } from "@/lib/wordpress-connector/security";

async function authorize(websiteId: string) {
  const context = await getAuthContext();
  if (!context?.organizationId || !can(context.role, "manage_websites")) return null;
  const admin = createAdminClient();
  const { data } = await admin.from("websites").select("id, organization_id")
    .eq("id", websiteId).eq("organization_id", context.organizationId)
    .eq("active", true).eq("platform", "wordpress").maybeSingle();
  return data ? { context, admin, website: data } : null;
}

export async function createWordPressPairing(websiteId: string): Promise<{ code?: string; error?: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(websiteId)) return { error: "invalid" };
  const authorized = await authorize(websiteId);
  if (!authorized) return { error: "forbidden" };
  const code = newPairingCode();
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
  const { error } = await authorized.admin.from("wordpress_connector_pairing_codes").insert({
    organization_id: authorized.website.organization_id,
    website_id: websiteId,
    code_hash: sha256(code),
    expires_at: expiresAt,
    created_by: authorized.context.userId,
  });
  if (error) {
    console.error("WordPress connector pairing code creation failed", { code: error.code });
    return { error: "save" };
  }
  await authorized.admin.from("audit_logs").insert({ organization_id: authorized.website.organization_id, actor_user_id: authorized.context.userId, action: "wordpress_connector.pairing_created", entity_type: "website", entity_id: websiteId, metadata: { expires_at: expiresAt } });
  return { code };
}

export async function revokeWordPressConnector(websiteId: string): Promise<{ ok?: true; error?: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(websiteId)) return { error: "invalid" };
  const authorized = await authorize(websiteId);
  if (!authorized) return { error: "forbidden" };
  const { data, error } = await authorized.admin.from("wordpress_connectors").update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("website_id", websiteId).eq("organization_id", authorized.website.organization_id).eq("status", "active").select("id").maybeSingle();
  if (error || !data) return { error: "save" };
  const credentialRemoval = await authorized.admin.from("wordpress_connector_credentials").delete().eq("connector_id", data.id);
  if (credentialRemoval.error) {
    console.error("WordPress connector credential removal failed", { code: credentialRemoval.error.code });
    return { error: "save" };
  }
  await authorized.admin.from("audit_logs").insert({ organization_id: authorized.website.organization_id, actor_user_id: authorized.context.userId, action: "wordpress_connector.revoked", entity_type: "website", entity_id: websiteId, metadata: { connector_id: data.id } });
  return { ok: true };
}
