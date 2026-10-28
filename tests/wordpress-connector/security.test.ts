import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { decryptConnectorSecret, encryptConnectorSecret, reportSchema, validHmac } from "@/lib/wordpress-connector/security";
import { isConnectorReplayError, isSecurityDataStale } from "@/lib/wordpress-connector/status";

const previousKey = process.env.WORDPRESS_CONNECTOR_ENCRYPTION_KEY;
afterEach(() => {
  if (previousKey === undefined) delete process.env.WORDPRESS_CONNECTOR_ENCRYPTION_KEY;
  else process.env.WORDPRESS_CONNECTOR_ENCRYPTION_KEY = previousKey;
});

describe("WordPress connector security", () => {
  it("encrypts secrets with authenticated encryption and rejects tampering", () => {
    process.env.WORDPRESS_CONNECTOR_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    const encrypted = encryptConnectorSecret("private-credential");
    expect(encrypted).not.toContain("private-credential");
    expect(decryptConnectorSecret(encrypted)).toBe("private-credential");
    const [version, iv, tag, ciphertext] = encrypted.split(".");
    expect(() => decryptConnectorSecret(`${version}.${iv}.${tag}.${ciphertext.slice(1)}A`)).toThrow();
  });

  it("requires a 32-byte encryption key", () => {
    process.env.WORDPRESS_CONNECTOR_ENCRYPTION_KEY = randomBytes(16).toString("base64");
    expect(() => encryptConnectorSecret("secret")).toThrow(/32-byte/);
  });

  it("validates report fields and denies unexpected personal data", () => {
    const valid = {
      schema_version: 1,
      request_id: randomUUID(),
      collected_at: new Date().toISOString(),
      wordpress_version: "6.8.3",
      plugins: [{ slug: "example", name: "Example", version: "1.0", active: true, update_status: "unknown" }],
      spam_comment_count: 0,
    };
    expect(reportSchema.safeParse(valid).success).toBe(true);
    expect(reportSchema.safeParse({ ...valid, comments: [{ email: "user@example.com" }] }).success).toBe(false);
    expect(reportSchema.safeParse({ ...valid, plugins: Array(501).fill(valid.plugins[0]) }).success).toBe(false);
    expect(reportSchema.safeParse({ ...valid, schema_version: 2 }).success).toBe(true);
    expect(reportSchema.safeParse({ ...valid, schema_version: 3 }).success).toBe(false);
  });

  it("accepts explicit normalized v2 security statuses and keeps findings free of personal data", () => {
    const now = new Date().toISOString();
    const base = {
      schema_version: 2,
      request_id: randomUUID(),
      collected_at: now,
      wordpress_version: "6.8.3",
      plugins: [{ slug: "example", name: "Example", version: "1.0", active: true, update_status: "unknown" as const }],
      spam_comment_count: 0,
      security: {
        vulnerability_check: { status: "complete" as const, source: "wordfence_intelligence" as const, checked_at: now, advisories: [{ plugin_slug: "example", installed_version: "1.0", advisory_id: "wf-123", title: "Example advisory", severity: "high" as const, fixed_version: "1.1", reference_url: "https://www.wordfence.com/threat-intel/vulnerabilities/id/example" }] },
        activity_scan: { status: "complete_with_findings" as const, scanner: "wordfence" as const, scan_started_at: now, scan_completed_at: now, last_successful_scan_at: now, findings: [{ finding_id: "finding-1", category: "malware" as const, severity: "critical" as const, title: "Malware signature detected", detected_at: now }] },
      },
    };
    expect(reportSchema.safeParse(base).success).toBe(true);
    expect(reportSchema.safeParse({ ...base, security: { ...base.security, activity_scan: { ...base.security.activity_scan, findings: [{ ...base.security.activity_scan.findings[0], ip_address: "192.0.2.1" }] } } }).success).toBe(false);
    expect(reportSchema.safeParse({ ...base, security: { ...base.security, vulnerability_check: { ...base.security.vulnerability_check, reference_url: "https://attacker.example/advisory" } } }).success).toBe(false);
  });

  it("rejects fabricated success timestamps and inconsistent scanner results", () => {
    const now = new Date().toISOString();
    const valid = {
      schema_version: 2,
      request_id: randomUUID(),
      collected_at: now,
      wordpress_version: "6.8.3",
      plugins: [],
      spam_comment_count: 0,
      security: {
        vulnerability_check: { status: "not_run" as const, source: null, checked_at: null, advisories: [] },
        activity_scan: { status: "not_run" as const, scanner: null, scan_started_at: null, scan_completed_at: null, last_successful_scan_at: null, findings: [] },
      },
    };
    expect(reportSchema.safeParse(valid).success).toBe(true);
    expect(reportSchema.safeParse({ ...valid, security: { ...valid.security, activity_scan: { ...valid.security.activity_scan, last_successful_scan_at: now } } }).success).toBe(false);
    expect(reportSchema.safeParse({ ...valid, security: { ...valid.security, activity_scan: { ...valid.security.activity_scan, status: "complete_with_no_findings" } } }).success).toBe(false);
    expect(reportSchema.safeParse({ ...valid, security: { ...valid.security, vulnerability_check: { ...valid.security.vulnerability_check, status: "complete", source: "wordfence_intelligence", checked_at: now, advisories: [] } } }).success).toBe(true);
  });

  it("authenticates exact raw bytes and binds timestamp and request ID", () => {
    const secret = "a-secret";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const requestId = randomUUID();
    const raw = '{"x":1}';
    const signature = createHmac("sha256", secret).update(`${timestamp}.${requestId}.${raw}`).digest("hex");
    expect(validHmac(secret, timestamp, requestId, raw, signature)).toBe(true);
    expect(validHmac(secret, timestamp, requestId, '{ "x": 1 }', signature)).toBe(false);
    expect(validHmac(secret, timestamp, randomUUID(), raw, signature)).toBe(false);
  });

  it("keeps missing and stale security data distinct from recent completed checks", () => {
    const evaluatedAt = "2026-10-23T12:00:00.000Z";
    expect(isSecurityDataStale(null, evaluatedAt, 7 * 24 * 60 * 60_000)).toBe(true);
    expect(isSecurityDataStale("2026-10-01T12:00:00.000Z", evaluatedAt, 7 * 24 * 60 * 60_000)).toBe(true);
    expect(isSecurityDataStale("2026-10-22T12:00:00.000Z", evaluatedAt, 7 * 24 * 60 * 60_000)).toBe(false);
  });

  it("maps database uniqueness violations to replay conflicts", () => {
    expect(isConnectorReplayError("23505")).toBe(true);
    expect(isConnectorReplayError("P0002")).toBe(false);
    expect(isConnectorReplayError(undefined)).toBe(false);
  });
});
