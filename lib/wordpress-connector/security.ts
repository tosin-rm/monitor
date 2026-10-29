import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const key = () => {
  const encoded = process.env.WORDPRESS_CONNECTOR_ENCRYPTION_KEY;
  if (!encoded) throw new Error("WORDPRESS_CONNECTOR_ENCRYPTION_KEY is not configured");
  const value = Buffer.from(encoded, "base64");
  if (value.length !== 32) throw new Error("WORDPRESS_CONNECTOR_ENCRYPTION_KEY must be a base64 encoded 32-byte key");
  return value;
};

export function encryptConnectorSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptConnectorSecret(encrypted: string): string {
  const [version, iv, tag, ciphertext] = encrypted.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("Invalid connector secret ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
export const newPairingCode = () => randomBytes(24).toString("base64url");
export const newConnectorSecret = () => randomBytes(32).toString("base64url");

export function validHmac(secret: string, timestamp: string, requestId: string, rawBody: string, received: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(received)) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${requestId}.${rawBody}`).digest();
  const actual = Buffer.from(received, "hex");
  return actual.length === expected.length && timingSafeEqual(expected, actual);
}

const pluginSchema = z.object({
  slug: z.string().min(1).max(200).regex(/^[a-zA-Z0-9._/-]+$/),
  name: z.string().min(1).max(200),
  version: z.string().max(100),
  active: z.boolean(),
  update_status: z.enum(["available", "unavailable", "unknown"]).optional(),
  update_available: z.boolean().optional(),
  update_version: z.string().max(100).optional().nullable(),
}).strict().superRefine((plugin, ctx) => {
  if ((plugin.update_status === undefined) === (plugin.update_available === undefined)) ctx.addIssue({ code: "custom", message: "Provide exactly one update status format" });
});

const severitySchema = z.enum(["critical", "high", "medium", "low", "unknown"]);
const sourceSchema = z.enum(["wordfence_intelligence", "wordfence", "solid_security", "sucuri", "other"]);
const securityStatusSchema = z.enum(["not_configured", "not_run", "failed", "complete"]);
const vulnerabilitySchema = z.object({
  plugin_slug: z.string().min(1).max(200).regex(/^[a-zA-Z0-9._/-]+$/),
  installed_version: z.string().min(1).max(100),
  advisory_id: z.string().min(1).max(100),
  title: z.string().min(1).max(200),
  severity: severitySchema,
  fixed_version: z.string().max(100).nullable().optional(),
  reference_url: z.string().url().max(500).refine((value) => {
    try { return new URL(value).protocol === "https:" && ["wordfence.com", "www.wordfence.com"].includes(new URL(value).hostname); }
    catch { return false; }
  }),
}).strict();
const vulnerabilityCheckSchema = z.object({
  status: securityStatusSchema,
  source: z.literal("wordfence_intelligence").nullable(),
  checked_at: z.string().datetime({ offset: true }).nullable(),
  advisories: z.array(vulnerabilitySchema).max(500),
}).strict().superRefine((value, ctx) => {
  if (value.status === "complete" && (!value.source || !value.checked_at)) ctx.addIssue({ code: "custom", message: "Completed vulnerability checks require a source and timestamp" });
  if (value.status !== "complete" && value.advisories.length) ctx.addIssue({ code: "custom", message: "Incomplete vulnerability checks cannot include advisories" });
});
const scanFindingSchema = z.object({
  finding_id: z.string().min(1).max(100),
  category: z.enum(["malware", "modified_file", "suspicious_user", "suspicious_activity", "firewall_event", "other"]),
  severity: severitySchema,
  title: z.string().min(1).max(200),
  detected_at: z.string().datetime({ offset: true }).nullable().optional(),
}).strict();
const securityScanSchema = z.object({
  status: z.enum(["not_configured", "not_run", "failed", "complete_with_findings", "complete_with_no_findings"]),
  scanner: sourceSchema.nullable(),
  scan_started_at: z.string().datetime({ offset: true }).nullable(),
  scan_completed_at: z.string().datetime({ offset: true }).nullable(),
  last_successful_scan_at: z.string().datetime({ offset: true }).nullable(),
  findings: z.array(scanFindingSchema).max(200),
}).strict().superRefine((value, ctx) => {
  const completed = value.status === "complete_with_findings" || value.status === "complete_with_no_findings";
  if (completed && (!value.scanner || !value.scan_started_at || !value.scan_completed_at || !value.last_successful_scan_at)) {
    ctx.addIssue({ code: "custom", message: "Completed scans require scanner and completion timestamps" });
  }
  if (completed && value.last_successful_scan_at !== value.scan_completed_at) ctx.addIssue({ code: "custom", message: "Last successful scan time must equal successful scan completion time" });
  if (value.status === "complete_with_findings" && value.findings.length === 0) ctx.addIssue({ code: "custom", message: "Completed scan with findings must include findings" });
  if (value.status === "complete_with_no_findings" && value.findings.length !== 0) ctx.addIssue({ code: "custom", message: "Completed scan with no findings cannot include findings" });
  if (!completed && (value.findings.length || value.last_successful_scan_at)) ctx.addIssue({ code: "custom", message: "Incomplete scans cannot include findings or a successful scan timestamp" });
});
const securitySchema = z.object({ vulnerability_check: vulnerabilityCheckSchema, activity_scan: securityScanSchema }).strict();

const contractSecuritySchema = z.object({
  vulnerability_data: z.object({
    status: z.enum(["completed", "stale", "unavailable", "not_run", "unsupported", "error"]),
    source: z.string().max(100).nullable(),
    checked_at: z.string().datetime({ offset: true }).nullable(),
    findings: z.array(z.record(z.string(), z.unknown())).max(500),
    note: z.string().max(1000).optional(),
  }).strict().superRefine((value, ctx) => {
    const successful = value.status === "completed" || value.status === "stale";
    if (successful && (!value.source || !value.checked_at)) ctx.addIssue({ code: "custom", message: "Completed or stale vulnerability data requires source and check time" });
    if (!successful && value.findings.length) ctx.addIssue({ code: "custom", message: "Unavailable vulnerability data cannot contain findings" });
  }),
  suspicious_activity: z.object({
    status: z.enum(["completed", "stale", "unavailable", "not_run", "unsupported", "error"]),
    source: z.string().max(100).nullable(),
    findings: z.array(z.record(z.string(), z.unknown())).max(200),
  }).strict().superRefine((value, ctx) => {
    if (value.status !== "completed" && value.status !== "stale" && value.findings.length) ctx.addIssue({ code: "custom", message: "Unavailable activity status cannot contain findings" });
    if ((value.status === "completed" || value.status === "stale") && !value.source) ctx.addIssue({ code: "custom", message: "Completed or stale activity requires a source" });
  }),
  core_integrity: z.object({
    status: z.enum(["complete", "unavailable", "not_run"]),
    source: z.literal("wordpress_core_checksums").nullable(),
    reason: z.enum(["checksum_api_missing", "checksum_list_unavailable", "checksum_data_invalid", "wordpress_root_unavailable", "core_path_unreadable", "checksum_check_failed"]).nullable().optional(),
    checked_at: z.string().datetime({ offset: true }).nullable(),
    checked_file_count: z.number().int().min(0).max(10000),
    modified_file_count: z.number().int().min(0).max(10000),
    missing_file_count: z.number().int().min(0).max(10000),
    modified_files: z.array(z.string().min(1).max(500)).max(100),
    missing_files: z.array(z.string().min(1).max(500)).max(100),
    findings_truncated: z.boolean(),
  }).strict().superRefine((value, ctx) => {
    if (value.status === "complete" && (!value.source || !value.checked_at)) ctx.addIssue({ code: "custom", message: "Completed core integrity checks require a source and timestamp" });
    if (value.status === "complete" && value.reason) ctx.addIssue({ code: "custom", message: "Completed core checks cannot include an unavailable reason" });
    if (value.status !== "complete" && (value.source || value.checked_at || value.checked_file_count || value.modified_file_count || value.missing_file_count || value.modified_files.length || value.missing_files.length || value.findings_truncated)) {
      ctx.addIssue({ code: "custom", message: "Unavailable core integrity checks cannot include results" });
    }
    if (value.modified_files.length > value.modified_file_count || value.missing_files.length > value.missing_file_count) ctx.addIssue({ code: "custom", message: "Core integrity finding samples cannot exceed finding counts" });
    if (value.findings_truncated !== (value.modified_files.length < value.modified_file_count || value.missing_files.length < value.missing_file_count)) ctx.addIssue({ code: "custom", message: "Core integrity truncation marker does not match its finding samples" });
  }).optional(),
  software_integrity: z.object({
    status: z.enum(["complete", "partial", "unavailable", "not_run"]),
    source: z.literal("wordpress_org_plugin_checksums").nullable(),
    checked_at: z.string().datetime({ offset: true }).nullable(),
    checked_plugin_count: z.number().int().min(0).max(500),
    checked_file_count: z.number().int().min(0).max(100000),
    unavailable_plugin_count: z.number().int().min(0).max(500),
    not_checked_plugin_count: z.number().int().min(0).max(500),
    modified_file_count: z.number().int().min(0).max(100000),
    missing_file_count: z.number().int().min(0).max(100000),
    modified_files: z.array(z.string().min(1).max(500)).max(100),
    missing_files: z.array(z.string().min(1).max(500)).max(100),
    findings_truncated: z.boolean(),
  }).strict().superRefine((value, ctx) => {
    if ((value.status === "complete" || value.status === "partial") && (!value.source || !value.checked_at || value.checked_plugin_count < 1)) ctx.addIssue({ code: "custom", message: "Plugin checksum results require a source, timestamp, and at least one checked plugin" });
    if ((value.status === "unavailable" || value.status === "not_run") && (value.source || value.checked_at || value.checked_plugin_count || value.checked_file_count || value.modified_file_count || value.missing_file_count || value.modified_files.length || value.missing_files.length)) ctx.addIssue({ code: "custom", message: "Unavailable plugin checksum results cannot include successful check results" });
    if (value.modified_files.length > value.modified_file_count || value.missing_files.length > value.missing_file_count) ctx.addIssue({ code: "custom", message: "Plugin checksum finding samples cannot exceed finding counts" });
    if (value.findings_truncated !== (value.modified_files.length < value.modified_file_count || value.missing_files.length < value.missing_file_count)) ctx.addIssue({ code: "custom", message: "Plugin checksum truncation marker does not match its finding samples" });
  }).optional(),
  local_file_scan: z.object({
    status: z.enum(["complete", "unavailable"]),
    source: z.literal("monitor_connector_static_checks"),
    coverage: z.enum(["complete", "partial"]),
    checked_at: z.string().datetime({ offset: true }).nullable(),
    checked_file_count: z.number().int().min(0).max(2000),
    findings: z.array(z.record(z.string(), z.unknown())).max(100),
    findings_truncated: z.boolean(),
  }).strict().superRefine((value, ctx) => {
    if (value.status === "complete" && (!value.checked_at || value.checked_file_count < 1)) ctx.addIssue({ code: "custom", message: "Completed local file scans require a timestamp and at least one checked file" });
    if (value.status === "unavailable" && (value.checked_at || value.checked_file_count || value.findings.length)) ctx.addIssue({ code: "custom", message: "Unavailable local file scans cannot include successful results" });
  }).optional(),
  last_successful_scan_at: z.string().datetime({ offset: true }).nullable(),
  scan_status: z.enum(["completed", "stale", "unavailable", "not_run", "unsupported", "error"]),
}).strict().superRefine((value, ctx) => {
  const noScan = value.scan_status !== "completed" && value.scan_status !== "stale";
  if (noScan && value.last_successful_scan_at !== null) ctx.addIssue({ code: "custom", message: "Unsuccessful scan states must preserve a null completion time" });
  if ((value.scan_status === "completed" || value.scan_status === "stale") && value.last_successful_scan_at === null) ctx.addIssue({ code: "custom", message: "Completed or stale scan requires a successful timestamp" });
});

const securityReportSchema = z.union([securitySchema, contractSecuritySchema]);

export const reportSchema = z.object({
  schema_version: z.union([z.literal(1), z.literal(1.1), z.literal(2)]),
  request_id: z.string().uuid(),
  collected_at: z.string().datetime({ offset: true }),
  wordpress_version: z.string().min(1).max(100),
  plugins: z.array(pluginSchema).max(500),
  spam_comment_count: z.number().int().min(0).max(100_000_000),
  security: securityReportSchema.optional(),
}).strict().superRefine((value, ctx) => {
  if (value.schema_version === 1 && value.security) ctx.addIssue({ code: "custom", message: "Schema 1.0 does not include security status" });
  if (value.schema_version === 1.1 && !value.security) ctx.addIssue({ code: "custom", message: "Schema 1.1 requires security status" });
  if (value.schema_version === 2 && value.security && !("vulnerability_check" in value.security)) ctx.addIssue({ code: "custom", message: "Schema 2 uses the legacy security contract" });
  if (value.schema_version === 1.1 && value.security && "vulnerability_check" in value.security) ctx.addIssue({ code: "custom", message: "Schema 1.1 uses the source-status contract" });
});
export type ConnectorReport = z.infer<typeof reportSchema>;

export function normalizePluginInventory(plugins: ConnectorReport["plugins"]) {
  return plugins.map((plugin) => {
    const { update_available, ...rest } = plugin;
    return {
      ...rest,
      update_status: plugin.update_status ?? (update_available === true ? "available" : update_available === false ? "unavailable" : "unknown"),
    };
  });
}

export function reportSecurityTimestamps(report: ConnectorReport): Array<string | null | undefined> {
  if (!report.security) return [];
  if ("vulnerability_check" in report.security) return [
    report.security.vulnerability_check.checked_at,
    report.security.activity_scan.scan_started_at,
    report.security.activity_scan.scan_completed_at,
    report.security.activity_scan.last_successful_scan_at,
    ...report.security.activity_scan.findings.map((finding) => finding.detected_at),
  ];
  return [report.security.vulnerability_data.checked_at, report.security.core_integrity?.checked_at, report.security.software_integrity?.checked_at, report.security.local_file_scan?.checked_at, report.security.last_successful_scan_at];
}
