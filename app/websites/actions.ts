"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { can } from "@/lib/auth/roles";
import { getAuthContext } from "@/lib/auth/session";
import { LIFECYCLE_STATUSES } from "@/lib/lifecycle/status";
import { checkWebsitePerformance } from "@/lib/health/pagespeed";
import { lookupDomainExpiry } from "@/lib/rdap/client";
import { safeRdapFetch } from "@/lib/rdap/safe-fetch";
import { inspectCertificate } from "@/lib/ssl/inspect";
import { normalizeDomain, normalizeHttpUrl } from "@/lib/urls";
import { parsePublicHttpUrl } from "@/lib/ssrf/validate";
import { createAdminClient } from "@/lib/supabase/admin";
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
  if (!context.organizationId) redirect("/access-pending");
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
  const { data: client, error: clientError } = await supabase.from("clients").select("id")
    .eq("id", input.clientId).eq("organization_id", context.organizationId).eq("active", true).maybeSingle();
  if (clientError) {
    console.error("Website client validation failed", { code: clientError.code });
    redirect("/websites?error=save");
  }
  if (!client) redirect("/websites?error=invalid");
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

export async function updateWebsiteLifecycle(formData: FormData): Promise<void> {
  const context = await requireManager("manage_websites");
  const websiteId = String(formData.get("websiteId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!z.string().uuid().safeParse(websiteId).success || !LIFECYCLE_STATUSES.includes(status as (typeof LIFECYCLE_STATUSES)[number])) {
    redirect("/websites?error=invalid");
  }
  const supabase = await createClient();
  const { data, error } = await supabase.from("websites").update({
    lifecycle_status: status,
    active: status === "active",
  })
    .eq("id", websiteId).eq("organization_id", context.organizationId)
    .select("id").maybeSingle();
  if (error || !data) {
    console.error("Website lifecycle update failed", { code: error?.code ?? "not_found" });
    redirect(`/websites/${websiteId}?error=lifecycle`);
  }
  redirect(`/websites/${websiteId}?success=lifecycle`);
}

export async function runWebsitePerformanceScan(formData: FormData): Promise<void> {
  const context = await requireManager("manage_websites");
  const parsed = z.object({
    websiteId: z.string().uuid(),
    strategy: z.enum(["mobile", "desktop"]),
  }).safeParse({
    websiteId: String(formData.get("websiteId") ?? ""),
    strategy: String(formData.get("strategy") ?? ""),
  });
  if (!parsed.success) {
    redirect("/websites?error=invalid");
  }
  const { websiteId, strategy } = parsed.data;
  const supabase = await createClient();
  const { data: website, error: websiteError } = await supabase.from("websites")
    .select("id, organization_id, primary_url")
    .eq("id", websiteId)
    .eq("organization_id", context.organizationId)
    .eq("active", true)
    .maybeSingle();
  if (websiteError || !website) {
    console.error("Performance scan website lookup failed", { code: websiteError?.code ?? "not_found" });
    redirect(`/websites/${websiteId}?device=${strategy}&error=scan`);
  }

  const admin = createAdminClient();
  const { data: recentChecks, error: checksError } = await admin.from("check_results")
    .select("checked_at, metadata")
    .eq("organization_id", context.organizationId)
    .eq("website_id", websiteId)
    .eq("check_type", "performance")
    .order("checked_at", { ascending: false })
    .limit(20);
  if (checksError) {
    console.error("Performance scan cooldown lookup failed", { code: checksError.code });
    redirect(`/websites/${websiteId}?device=${strategy}&error=scan`);
  }
  const latestForDevice = recentChecks?.find((check) => {
    const metadata = check.metadata as Record<string, unknown> | null;
    return (metadata?.strategy ?? "mobile") === strategy;
  });
  if (latestForDevice && Date.now() - new Date(latestForDevice.checked_at).getTime() < 5 * 60 * 1000) {
    redirect(`/websites/${websiteId}?device=${strategy}&success=scan_recent`);
  }

  let success: boolean;
  try {
    ({ success } = await checkWebsitePerformance(
      admin,
      website,
      new Date(),
      strategy,
      process.env.PAGESPEED_API_KEY,
    ));
  } catch (error) {
    console.error("On-demand performance scan failed", {
      code: error && typeof error === "object" && "code" in error ? error.code : "scan_error",
    });
    redirect(`/websites/${websiteId}?device=${strategy}&error=scan`);
  }
  redirect(`/websites/${websiteId}?device=${strategy}&success=${success ? "scan" : "scan_failed"}`);
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
  const requestedSource = String(formData.get("expirySource") ?? "manual");
  const sourceIsValid = requestedSource === "rdap" && parsed.data.assetType === "domain"
    || requestedSource === "certificate_inspection" && parsed.data.assetType === "ssl_certificate"
    || requestedSource === "manual";
  if (!sourceIsValid) return null;
  const dateSource = expiryDate ? requestedSource : "unknown";
  const dateUnchanged = existing !== undefined && existing.expiry_date === expiryDate;
  const sourceUnchanged = existing !== undefined && existing.date_source === dateSource;
  const updateDateMetadata = !dateUnchanged || !sourceUnchanged || verified;
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
    date_source: updateDateMetadata ? dateSource : existing.date_source,
    date_confidence: updateDateMetadata
      ? (expiryDate ? (dateSource === "manual" ? (verified ? "high" : "medium") : "medium") : "none")
      : existing.date_confidence,
    manual_override: updateDateMetadata ? Boolean(expiryDate && dateSource === "manual") : existing.manual_override,
    last_verified_at: expiryDate && (verified || dateSource !== "manual")
      ? new Date().toISOString()
      : dateUnchanged && sourceUnchanged
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

export async function lookupAssetExpiry(assetType: string, hostname: string): Promise<{
  success: boolean;
  expiryDate?: string;
  source?: "rdap" | "certificate_inspection";
  message: string;
}> {
  await requireManager("manage_assets");
  const parsedHostname = z.string().trim().min(1).max(253).safeParse(hostname);
  if (!parsedHostname.success) {
    return { success: false, message: "Enter a valid domain or hostname first." };
  }

  if (assetType === "domain") {
    let domain: string;
    try {
      domain = normalizeDomain(parsedHostname.data);
    } catch {
      return { success: false, message: "Enter a valid domain name." };
    }
    const result = await lookupDomainExpiry({ domain, fetchImpl: safeRdapFetch });
    if (result.status !== "ok" || !result.expiryDate) {
      const messages = {
        ok: "The domain registry did not return a usable expiry date.",
        missing_expiry: "The domain registry did not publish an expiry date.",
        unsupported: "No RDAP registry is available for this domain.",
        rate_limited: "The domain registry is temporarily rate-limiting lookups. Try again later.",
        invalid_response: "The domain registry returned an invalid response.",
        network_failure: "The domain registry could not be reached. Try again later.",
        not_found: "The domain was not found in the registry.",
      } as const;
      return { success: false, message: messages[result.status] };
    }
    return {
      success: true,
      expiryDate: result.expiryDate,
      source: "rdap",
      message: "RDAP found an expiry date. Review it before saving.",
    };
  }

  if (assetType === "ssl_certificate") {
    const inspection = await inspectCertificate({ hostname: parsedHostname.data });
    if (!inspection.validTo) {
      return {
        success: false,
        message: inspection.sanitizedError ?? "A certificate expiry date could not be read.",
      };
    }
    return {
      success: true,
      expiryDate: inspection.validTo.slice(0, 10),
      source: "certificate_inspection",
      message: inspection.success
        ? "The live certificate expiry was found. Review it before saving."
        : `Expiry found, but the certificate has an issue: ${inspection.sanitizedError ?? "inspection incomplete"}. Review it before saving.`,
    };
  }

  return { success: false, message: "Automatic lookup is available for domain and SSL certificate assets only." };
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
  if (!context.organizationId) redirect("/access-pending");
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

export async function removeMonitoringEndpoint(formData: FormData): Promise<void> {
  const context = await requireManager("manage_monitoring");
  const endpointId = String(formData.get("endpointId") ?? "");
  const websiteId = String(formData.get("websiteId") ?? "");
  if (!z.string().uuid().safeParse(endpointId).success || !z.string().uuid().safeParse(websiteId).success) {
    redirect("/websites?error=invalid");
  }
  // The authenticated role intentionally has no DELETE grant on this table.
  // Authorization is checked above; use the service role for this scoped delete.
  const admin = createAdminClient();
  const { data, error } = await admin.from("monitoring_endpoints").delete()
    .eq("id", endpointId)
    .eq("website_id", websiteId)
    .eq("organization_id", context.organizationId)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    console.error("Monitoring endpoint removal failed", { code: error?.code ?? "not_found" });
    redirect(`/websites/${websiteId}?error=endpoint_remove`);
  }
  redirect(`/websites/${websiteId}?success=endpoint_removed`);
}
