import { describe, expect, it } from "vitest";
import { isVersionAffected, matchWordfenceAdvisories, normalizeWordfenceFeed } from "@/lib/wordpress-connector/wordfence";

const advisoryId = "123e4567-e89b-12d3-a456-426614174000";
const feed = {
  [advisoryId]: {
    title: "Example plugin vulnerability",
    software: [
      {
        type: "plugin",
        slug: "example-plugin",
        name: "Example Plugin",
        affected_versions: { "1.0.0 - 1.4.0": { from_version: "1.0.0", from_inclusive: true, to_version: "1.4.0", to_inclusive: true } },
        patched_versions: ["1.4.1"],
      },
      {
        type: "theme",
        slug: "example-theme",
        name: "Example Theme",
        affected_versions: { "*": { from_version: "*", to_version: "*" } },
      },
    ],
    cvss: { score: 8.1, rating: "High" },
    published: "2026-01-02 03:04:05",
    updated: "2026-01-03 03:04:05",
    copyrights: {
      defiant: { notice: "Defiant notice", license: "Defiant license text", license_url: "https://www.wordfence.com/terms" },
      mitre: { notice: "MITRE notice", license: "MITRE license text", license_url: "https://www.cve.org/legal" },
    },
  },
};

describe("Wordfence vulnerability feed", () => {
  it("keeps only installed WordPress plugin advisories and normalizes safe display fields", () => {
    const records = normalizeWordfenceFeed(feed, new Set(["example-plugin"]));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      advisory_id: advisoryId,
      software_slug: "example-plugin",
      severity: "high",
      cvss_score: 8.1,
      patched_versions: ["1.4.1"],
      published_at: "2026-01-02T03:04:05.000Z",
      defiant_notice: "Defiant notice",
      defiant_license: "Defiant license text",
      mitre_license: "MITRE license text",
      mitre_notice: "MITRE notice",
      reference_url: `https://www.wordfence.com/threat-intel/vulnerabilities/id/${advisoryId}`,
    });
  });

  it("matches inclusive and exclusive version bounds without guessing nonnumeric versions", () => {
    const ranges = { range: { from_version: "1.0", from_inclusive: true, to_version: "1.4.0", to_inclusive: false } };
    expect(isVersionAffected("1.0", ranges)).toBe(true);
    expect(isVersionAffected("1.3.9", ranges)).toBe(true);
    expect(isVersionAffected("1.4", ranges)).toBe(false);
    expect(isVersionAffected("1.2-beta", ranges)).toBeNull();
  });

  it("returns only version-matched advisories and flags versions it cannot compare", () => {
    const records = normalizeWordfenceFeed(feed, new Set(["example-plugin"]));
    const result = matchWordfenceAdvisories([
      { slug: "example-plugin", version: "1.2.0" },
      { slug: "example-plugin", version: "2.0.0" },
      { slug: "example-plugin", version: "trunk" },
    ], records);
    expect(result.advisories.map((item) => item.installed_version)).toEqual(["1.2.0"]);
    expect(result.unassessedSlugs).toEqual(["example-plugin"]);
  });

  it("rejects malformed feed shapes", () => {
    expect(() => normalizeWordfenceFeed([], new Set())).toThrow("invalid_feed_shape");
  });
});
