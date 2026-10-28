export type WordfenceAdvisoryRecord = {
  advisory_id: string;
  software_slug: string;
  software_name: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low" | "unknown";
  cvss_score: number | null;
  affected_versions: Record<string, { from_version?: string; from_inclusive?: boolean; to_version?: string; to_inclusive?: boolean }>;
  patched_versions: string[];
  reference_url: string;
  published_at: string | null;
  updated_at: string | null;
  defiant_notice: string | null;
  defiant_license: string | null;
  defiant_license_url: string | null;
  mitre_notice: string | null;
  mitre_license: string | null;
  mitre_license_url: string | null;
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
}

function dateOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(`${value.replace(" ", "T")}Z`);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function safeLicenseUrl(value: unknown, hosts: string[]): string | null {
  if (typeof value !== "string" || value.length > 500) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && hosts.includes(url.hostname) ? url.toString() : null;
  } catch { return null; }
}

function severityFrom(value: unknown): WordfenceAdvisoryRecord["severity"] {
  if (typeof value !== "string") return "unknown";
  const lower = value.toLowerCase();
  return ["critical", "high", "medium", "low"].includes(lower) ? lower as WordfenceAdvisoryRecord["severity"] : "unknown";
}

export function normalizeWordfenceFeed(payload: unknown, installedSlugs: Set<string>): WordfenceAdvisoryRecord[] {
  const root = asRecord(payload);
  if (!root) throw new Error("invalid_feed_shape");
  const results: WordfenceAdvisoryRecord[] = [];
  for (const [advisoryId, rawAdvisory] of Object.entries(root)) {
    if (!/^[0-9a-f-]{36}$/i.test(advisoryId)) continue;
    const advisory = asRecord(rawAdvisory);
    if (!advisory || advisory.informational === true || !Array.isArray(advisory.software)) continue;
    const cvss = asRecord(advisory.cvss);
    const copyrights = asRecord(advisory.copyrights);
    const defiant = asRecord(copyrights?.defiant);
    const mitre = asRecord(copyrights?.mitre);
    for (const rawSoftware of advisory.software) {
      const software = asRecord(rawSoftware);
      if (!software || software.type !== "plugin" || typeof software.slug !== "string") continue;
      const slug = software.slug.toLowerCase();
      if (!installedSlugs.has(slug)) continue;
      const rawRanges = asRecord(software.affected_versions);
      if (!rawRanges) continue;
      const affectedVersions: WordfenceAdvisoryRecord["affected_versions"] = {};
      for (const [range, value] of Object.entries(rawRanges)) {
        const bounds = asRecord(value);
        if (!bounds) continue;
        affectedVersions[range] = {
          from_version: typeof bounds.from_version === "string" ? bounds.from_version : undefined,
          from_inclusive: typeof bounds.from_inclusive === "boolean" ? bounds.from_inclusive : undefined,
          to_version: typeof bounds.to_version === "string" ? bounds.to_version : undefined,
          to_inclusive: typeof bounds.to_inclusive === "boolean" ? bounds.to_inclusive : undefined,
        };
      }
      if (!Object.keys(affectedVersions).length) continue;
      const cvssScore = typeof cvss?.score === "number" && cvss.score >= 0 && cvss.score <= 10 ? cvss.score : null;
      const publishedAt = dateOrNull(advisory.published);
      const updatedAt = dateOrNull(advisory.updated);
      const defiantNotice = typeof defiant?.notice === "string" ? defiant.notice.slice(0, 500) : null;
      const defiantLicense = typeof defiant?.license === "string" ? defiant.license.slice(0, 5000) : null;
      const defiantLicenseUrl = safeLicenseUrl(defiant?.license_url, ["wordfence.com", "www.wordfence.com"]);
      const mitreNotice = typeof mitre?.notice === "string" ? mitre.notice.slice(0, 500) : null;
      const mitreLicense = typeof mitre?.license === "string" ? mitre.license.slice(0, 5000) : null;
      const mitreLicenseUrl = safeLicenseUrl(mitre?.license_url, ["cve.org", "www.cve.org"]);
      const patched = Array.isArray(software.patched_versions)
        ? software.patched_versions.filter((version): version is string => typeof version === "string").slice(0, 50)
        : [];
      results.push({
        advisory_id: advisoryId.toLowerCase(),
        software_slug: slug,
        software_name: typeof software.name === "string" ? software.name.slice(0, 200) : slug,
        title: typeof advisory.title === "string" ? advisory.title.slice(0, 300) : "WordPress plugin vulnerability",
        severity: severityFrom(cvss?.rating),
        cvss_score: cvssScore,
        affected_versions: affectedVersions,
        patched_versions: patched,
        reference_url: `https://www.wordfence.com/threat-intel/vulnerabilities/id/${advisoryId.toLowerCase()}`,
        published_at: publishedAt,
        updated_at: updatedAt,
        defiant_notice: defiantNotice,
        defiant_license: defiantLicense,
        defiant_license_url: defiantLicenseUrl,
        mitre_notice: mitreNotice,
        mitre_license: mitreLicense,
        mitre_license_url: mitreLicenseUrl,
      });
    }
  }
  return results;
}

function compareNumericVersions(left: string, right: string): number | null {
  if (!/^\d+(?:\.\d+)*$/.test(left) || !/^\d+(?:\.\d+)*$/.test(right)) return null;
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) return delta < 0 ? -1 : 1;
  }
  return 0;
}

export function isVersionAffected(version: string, ranges: WordfenceAdvisoryRecord["affected_versions"]): boolean | null {
  if (!/^\d+(?:\.\d+)*$/.test(version)) return null;
  let comparableRangeFound = false;
  for (const range of Object.values(ranges)) {
    const from = range.from_version;
    const to = range.to_version;
    const fromComparison = !from || from === "*" ? null : compareNumericVersions(version, from);
    const toComparison = !to || to === "*" ? null : compareNumericVersions(version, to);
    if ((from && from !== "*" && fromComparison === null) || (to && to !== "*" && toComparison === null)) continue;
    comparableRangeFound = true;
    const aboveLower = fromComparison === null || fromComparison > 0 || (fromComparison === 0 && range.from_inclusive !== false);
    const belowUpper = toComparison === null || toComparison < 0 || (toComparison === 0 && range.to_inclusive !== false);
    if (aboveLower && belowUpper) return true;
  }
  return comparableRangeFound ? false : null;
}

export type MatchedWordfenceAdvisory = WordfenceAdvisoryRecord & { installed_version: string };

export function matchWordfenceAdvisories(
  plugins: Array<{ slug: string; version: string }>,
  records: WordfenceAdvisoryRecord[],
): { advisories: MatchedWordfenceAdvisory[]; unassessedSlugs: string[] } {
  const advisories: MatchedWordfenceAdvisory[] = [];
  const unassessedSlugs: string[] = [];
  const seen = new Set<string>();
  for (const plugin of plugins) {
    const candidates = records.filter((record) => record.software_slug === plugin.slug.toLowerCase());
    if (!/^\d+(?:\.\d+)*$/.test(plugin.version) && candidates.length) unassessedSlugs.push(plugin.slug);
    for (const record of candidates) {
      if (isVersionAffected(plugin.version, record.affected_versions) !== true) continue;
      const key = `${plugin.slug}:${record.advisory_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      advisories.push({ ...record, installed_version: plugin.version });
    }
  }
  return { advisories, unassessedSlugs };
}
