export type SecurityCheckStatus = "not_configured" | "not_run" | "failed" | "complete";
export type Severity = "critical" | "high" | "medium" | "low" | "unknown";
export type SecuritySource = "wordfence_intelligence" | "wordfence" | "solid_security" | "sucuri" | "other";

export type VulnerabilityAdvisory = {
  plugin_slug: string;
  installed_version: string;
  advisory_id: string;
  title: string;
  severity: Severity;
  fixed_version?: string | null;
  reference_url: string;
};

export type ActivityFinding = {
  finding_id: string;
  category: "malware" | "modified_file" | "suspicious_user" | "suspicious_activity" | "firewall_event" | "other";
  severity: Severity;
  title: string;
  detected_at?: string | null;
};

export type ConnectorSecurityReport = {
  vulnerability_check: {
    status: SecurityCheckStatus;
    source: "wordfence_intelligence" | null;
    checked_at: string | null;
    advisories: VulnerabilityAdvisory[];
  };
  activity_scan: {
    status: "not_configured" | "not_run" | "failed" | "complete_with_findings" | "complete_with_no_findings";
    scanner: SecuritySource | null;
    scan_started_at: string | null;
    scan_completed_at: string | null;
    last_successful_scan_at: string | null;
    findings: ActivityFinding[];
  };
};

export type ProposedConnectorSecurityReport = {
  vulnerability_data: {
    status: "completed" | "stale" | "unavailable" | "not_run" | "unsupported" | "error";
    source: string | null;
    checked_at: string | null;
    findings: Array<Record<string, unknown>>;
    note?: string;
  };
  suspicious_activity: {
    status: "completed" | "stale" | "unavailable" | "not_run" | "unsupported" | "error";
    source: string | null;
    findings: Array<Record<string, unknown>>;
  };
  core_integrity?: {
    status: "complete" | "unavailable" | "not_run";
    source: "wordpress_core_checksums" | null;
    reason?: "checksum_api_missing" | "checksum_list_unavailable" | "checksum_data_invalid" | "wordpress_root_unavailable" | "core_path_unreadable" | "checksum_check_failed" | null;
    checked_at: string | null;
    checked_file_count: number;
    excluded_content_file_count?: number;
    modified_file_count: number;
    missing_file_count: number;
    modified_files: string[];
    missing_files: string[];
    findings_truncated: boolean;
  };
  software_integrity?: {
    status: "complete" | "partial" | "unavailable" | "not_run";
    source: "wordpress_org_plugin_checksums" | null;
    checked_at: string | null;
    checked_plugin_count: number;
    checked_file_count: number;
    unavailable_plugin_count: number;
    not_checked_plugin_count: number;
    modified_file_count: number;
    missing_file_count: number;
    modified_files: string[];
    missing_files: string[];
    findings_truncated: boolean;
  };
  local_file_scan?: {
    status: "complete" | "unavailable";
    source: "monitor_connector_static_checks";
    coverage: "complete" | "partial";
    checked_at: string | null;
    checked_file_count: number;
    findings: Array<Record<string, unknown>>;
    findings_truncated: boolean;
  };
  last_successful_scan_at: string | null;
  scan_status: "completed" | "stale" | "unavailable" | "not_run" | "unsupported" | "error";
};
