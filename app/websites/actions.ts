"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { can } from "@/lib/auth/roles";
import { getAuthContext } from "@/lib/auth/session";
import { normalizeDomain, normalizeHttpUrl } from "@/lib/urls";
import { parsePublicHttpUrl } from "@/lib/ssrf/validate";
import { createClient } from "@/lib/supabase/server";

const optionalText = (max: number) => z.string().trim().max(max).transform((value) => value || null);
const isoDate = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
});
const websiteSchema = z.object({
  clientId: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  primaryUrl: z.string().trim().min(1).max(2048),
  platform: z.enum(["wordpress", "nextjs", "other", "unknown"]),
  environment: z.enum(["production", "staging", "development", "other"]),
});
const assetSchema = z.object({
  websiteId: z.string().uuid(),
  assetType: z.enum(["domain", "hosting", "ssl_certificate", "other"]),
  providerName: optionalText(160),
  providerAccountReference: optionalText(200),
  serviceName: optionalText(200),
  hostname: optionalText(253),
  expiryDate: z.union([isoDate, z.literal("")]),
  renewalUrl: z.union([z.string().trim().url().max(2048), z.literal("")]),
  renewalResponsibility: optionalText(160),
  renewalStatus: z.enum(["active", "renewal_pending", "renewed", "expired", "cancelled", "unknown"]),
});
const endpointSchema = z.object({
  websiteId: z.string().uuid(),
  endpointUrl: z.string().trim().min(1).max(2048),
  checkInterval: z.coerce.number().int().min(60).max(86_400),
  timeout: z.coerce.number().int().min(1).max(60),
});

async function requireManager(permission: "manage_websites" | "manage_assets" | "manage_monitoring") {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  if (!context.organizationId) redirect("/setup");
  if (!can(context.role, permission)) redirect("/?error=forbidden");
  return context;
}

function normalizeWebsiteForm(formData: FormData) {
  const parsed = websiteSchema.safeParse({
    clientId: String(formData.get("clientId") ?? ""),
    name: String(formData.get("name") ?? ""),
    primaryUrl: String(formData.get("primaryUrl") ?? ""),
    platform: String(formData.get("platform") ?? "unknown"),
    environment: String(formData.get("environment") ?? "production"),
  });
  if (!parsed.success) return null;
  try {
    parsePublicHttpUrl(normalizeHttpUrl(parsed.data.primaryUrl));
    return { ...parsed.data, primaryUrl: normalizeHttpUrl(parsed.data.primaryUrl) };
  } catch {
    return null;
  }
}

export async function createWebsite(formData: FormData): Promise<void> {
  const context = await requireManager("manage_websites");
  const input = normalizeWebsiteForm(formData);
  if (!input) redirect("/websites?error=invalid");
  const supabase = await createClient();
  const { data, error } = await supabase.from("websites").insert({
    organization_id: context.organizationId,
    client_id: input.clientId,
    name: input.name,
    primary_url: input.primaryUrl,
    platform: input.platform,
    environment: input.environment,
  }).select("id").single();
  if (error) {
    console.error("Website creation failed", { code: error.code });
    redirect("/websites?error=save");
  }
  redirect(`/websites/${data.id}`);
}

export async function updateWebsite(formData: FormData): Promise<void> {
  const context = await requireManager("manage_websites");
  const websiteId = String(formData.get("websiteId") ?? "");
  const input = normalizeWebsiteForm(formData);
  if (!websiteId || !input) redirect("/websites?error=invalid");
  const supabase = await createClient();
  const { data, error } = await supabase.from("websites").update({
    client_id: input.clientId,
    name: input.name,
    primary_url: input.primaryUrl,
    platform: input.platform,
    environment: input.environment,
  }).eq("id", websiteId).eq("organization_id", context.organizationId).select("id").maybeSingle();
  if (error || !data) {
    console.error("Website update failed", { code: error?.code ?? "not_found" });
    redirect(`/websites/${websiteId}?error=save`);
  }
  redirect(`/websites/${websiteId}?success=saved`);
}

export async function archiveWebsite(formData: FormData): Promise<void> {
  const context = await requireManager("manage_websites");
  const websiteId = String(formData.get("websiteId") ?? "");
  if (!websiteId) redirect("/websites?error=invalid");
  const supabase = await createClient();
  const { data, error } = await supabase.from("websites").update({ active: false })
    .eq("id", websiteId).eq("organization_id", context.organizationId).eq("active", true)
    .select("id").maybeSingle();
  if (error || !data) {
    console.error("Website archive failed", { code: error?.code ?? "not_found" });
    redirect(`/websites/${websiteId}?error=archive`);
  }
  redirect("/websites?success=archived");
}

function readAssetForm(formData: FormData, existing?: {
  expiry_date: string | null;
  date_source: string;
  date_confidence: string | null;
  manual_override: boolean;
  last_verified_at: string | null;
}) {
  const parsed = assetSchema.safeParse({
    websiteId: String(formData.get("websiteId") ?? ""),
    assetType: String(formData.get("assetType") ?? ""),
    providerName: String(formData.get("providerName") ?? ""),
    providerAccountReference: String(formData.get("providerAccountReference") ?? ""),
    serviceName: String(formData.get("serviceName") ?? ""),
    hostname: String(formData.get("hostname") ?? ""),
    expiryDate: String(formData.get("expiryDate") ?? ""),
    renewalUrl: String(formData.get("renewalUrl") ?? ""),
    renewalResponsibility: String(formData.get("renewalResponsibility") ?? ""),
    renewalStatus: String(formData.get("renewalStatus") ?? "unknown"),
  });
  if (!parsed.success) return null;
  let hostname = parsed.data.hostname;
  try {
    if (hostname && parsed.data.assetType === "domain") hostname = normalizeDomain(hostname);
    else if (hostname) hostname = new URL(`https://${hostname}`).hostname.toLowerCase();
    if (parsed.data.renewalUrl) parsePublicHttpUrl(parsed.data.renewalUrl);
  } catch {
    return null;
  }
  const expiryDate = parsed.data.expiryDate || null;
  const verified = String(formData.get("verified") ?? "") === "on";
  const dateUnchanged = existing !== undefined && existing.expiry_date === expiryDate;
  const updateDateMetadata = !dateUnchanged || verified;
  return {
    website_id: parsed.data.websiteId,
    asset_type: parsed.data.assetType,
    provider_name: parsed.data.providerName,
    provider_account_reference: parsed.data.providerAccountReference,
    service_name: parsed.data.serviceName,
    hostname,
    expiry_date: expiryDate,
    renewal_url: parsed.data.renewalUrl || null,
    renewal_responsibility: parsed.data.renewalResponsibility,
    renewal_status: parsed.data.renewalStatus,
    date_source: updateDateMetadata ? (expiryDate ? "manual" : "unknown") : existing.date_source,
    date_confidence: updateDateMetadata
      ? (expiryDate ? (verified ? "high" : "medium") : "none")
      : existing.date_confidence,
    manual_override: updateDateMetadata ? Boolean(expiryDate) : existing.manual_override,
    last_verified_at: expiryDate && verified
      ? new Date().toISOString()
      : dateUnchanged
        ? existing.last_verified_at
        : null,
  };
}

export async function createAsset(formData: FormData): Promise<void> {
  const context = await requireManager("manage_assets");
  const input = readAssetForm(formData);
  const websiteId = String(formData.get("websiteId") ?? "");
  if (!input) redirect(`/websites/${websiteId}?error=asset`);
  const supabase = await createClient();
  const { error } = await supabase.from("assets").insert({
    ...input,
    organization_id: context.organizationId,
  });
  if (error) {
    console.error("Infrastructure asset creation failed", { code: error.code });
    redirect(`/websites/${websiteId}?error=asset`);
  }
  redirect(`/websites/${websiteId}?success=asset`);
}

export async function updateAsset(formData: FormData): Promise<void> {
  const context = await requireManager("manage_assets");
  const assetId = String(formData.get("assetId") ?? "");
  if (!assetId) redirect("/inventory?error=invalid");
  const supabase = await createClient();
  const existing = await supabase.from("assets")
    .select("id, website_id, expiry_date, date_source, date_confidence, manual_override, last_verified_at")
    .eq("id", assetId)
    .eq("organization_id", context.organizationId)
    .maybeSingle();
  if (existing.error || !existing.data) {
    console.error("Infrastructure asset lookup failed", { code: existing.error?.code ?? "not_found" });
    redirect("/inventory?error=save");
  }
  const websiteId = existing.data.website_id;
  const input = readAssetForm(formData, existing.data);
  if (!input) redirect("/inventory?error=invalid");
  const { data, error } = await supabase.from("assets").update(input)
    .eq("id", assetId).eq("organization_id", context.organizationId)
    .select("id").maybeSingle();
  if (error || !data) {
    console.error("Infrastructure asset update failed", { code: error?.code ?? "not_found" });
    redirect("/inventory?error=save");
  }
  redirect(`/websites/${websiteId}?success=asset`);
}

export async function archiveAsset(formData: FormData): Promise<void> {
  const context = await requireManager("manage_assets");
  const assetId = String(formData.get("assetId") ?? "");
  const websiteId = String(formData.get("websiteId") ?? "");
  if (!assetId) redirect("/inventory?error=invalid");
  const supabase = await createClient();
  const { data, error } = await supabase.from("assets").update({ active: false })
    .eq("id", assetId).eq("organization_id", context.organizationId)
    .select("id").maybeSingle();
  if (error || !data) {
    console.error("Infrastructure asset archive failed", { code: error?.code ?? "not_found" });
    redirect("/inventory?error=save");
  }
  redirect(websiteId ? `/websites/${websiteId}` : "/inventory");
}

export async function confirmRenewal(formData: FormData): Promise<void> {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  if (!context.organizationId) redirect("/setup");
  if (!can(context.role, "confirm_renewals")) redirect("/inventory?error=forbidden");
  const assetId = String(formData.get("assetId") ?? "");
  const websiteId = String(formData.get("websiteId") ?? "");
  const expiryDate = String(formData.get("newExpiryDate") ?? "");
  const parsedDate = isoDate.safeParse(expiryDate);
  if (!assetId || !parsedDate.success) redirect("/inventory?error=invalid");
  const supabase = await createClient();
  const { error } = await supabase.rpc("confirm_asset_renewal", {
    p_asset_id: assetId,
    p_new_expiry_date: parsedDate.data,
    p_confirmation_method: "manual",
    p_confirmation_notes: String(formData.get("notes") ?? "").slice(0, 1000) || null,
  });
  if (error) {
    console.error("Renewal confirmation failed", { code: error.code });
    redirect("/inventory?error=renewal");
  }
  redirect(websiteId ? `/websites/${websiteId}?success=renewed` : "/inventory?success=renewed");
}

export async function createMonitoringEndpoint(formData: FormData): Promise<void> {
  const context = await requireManager("manage_monitoring");
  const parsed = endpointSchema.safeParse({
    websiteId: String(formData.get("websiteId") ?? ""),
    endpointUrl: String(formData.get("endpointUrl") ?? ""),
    checkInterval: formData.get("checkInterval") ?? "300",
    timeout: formData.get("timeout") ?? "15",
  });
  if (!parsed.success) redirect(`/websites/${String(formData.get("websiteId") ?? "")}?error=endpoint`);
  let endpointUrl: string;
  try {
    endpointUrl = normalizeHttpUrl(parsed.data.endpointUrl);
    parsePublicHttpUrl(endpointUrl);
  } catch {
    redirect(`/websites/${parsed.data.websiteId}?error=endpoint`);
  }
  const supabase = await createClient();
  const { error } = await supabase.from("monitoring_endpoints").insert({
    organization_id: context.organizationId,
    website_id: parsed.data.websiteId,
    endpoint_url: endpointUrl,
    check_interval_seconds: parsed.data.checkInterval,
    timeout_seconds: parsed.data.timeout,
  });
  if (error) {
    console.error("Monitoring endpoint creation failed", { code: error.code });
    redirect(`/websites/${parsed.data.websiteId}?error=endpoint`);
  }
  redirect(`/websites/${parsed.data.websiteId}?success=endpoint`);
}

export async function setMonitoringEndpoint(formData: FormData): Promise<void> {
  const context = await requireManager("manage_monitoring");
  const endpointId = String(formData.get("endpointId") ?? "");
  const websiteId = String(formData.get("websiteId") ?? "");
  const enabled = String(formData.get("enabled") ?? "") === "true";
  if (!endpointId || !websiteId) redirect("/websites?error=invalid");
  const supabase = await createClient();
  const { error } = await supabase.from("monitoring_endpoints").update({ enabled })
    .eq("id", endpointId).eq("organization_id", context.organizationId);
  if (error) {
    console.error("Monitoring endpoint update failed", { code: error.code });
    redirect(`/websites/${websiteId}?error=endpoint`);
  }
  redirect(`/websites/${websiteId}`);
}
