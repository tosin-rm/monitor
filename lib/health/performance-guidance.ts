export type LighthouseCategory =
  | "performance"
  | "accessibility"
  | "best-practices"
  | "seo";

export type LighthouseFinding = {
  id: string;
  title: string;
  description: string;
  score: number;
  displayValue: string | null;
  estimatedSavingsMs: number | null;
};

export type MetricGuidance = {
  label: string;
  value: string;
  target: string;
  assessment: "good" | "improve" | "poor";
  action: string;
};

type LighthouseAudit = {
  score?: number | null;
  scoreDisplayMode?: string;
  title?: string;
  description?: string;
  displayValue?: string;
  details?: { overallSavingsMs?: number };
};

type LighthouseCategoryData = {
  auditRefs?: Array<{ id?: string; weight?: number }>;
};

const CATEGORY_LABELS: Record<LighthouseCategory, string> = {
  performance: "Performance",
  accessibility: "Accessibility",
  "best-practices": "Best practices",
  seo: "SEO",
};

export function lighthouseCategoryLabel(category: LighthouseCategory): string {
  return CATEGORY_LABELS[category];
}

export function getLighthouseFindings(
  metadata: Record<string, unknown> | null | undefined,
  category: LighthouseCategory,
): LighthouseFinding[] {
  const findings = metadata?.category_findings;
  if (!findings || typeof findings !== "object" || Array.isArray(findings)) return [];
  const entries = (findings as Record<string, unknown>)[category];
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry): LighthouseFinding[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const value = entry as Record<string, unknown>;
    if (
      typeof value.id !== "string"
      || typeof value.title !== "string"
      || typeof value.description !== "string"
      || typeof value.score !== "number"
    ) return [];
    return [{
      id: value.id,
      title: value.title,
      description: value.description,
      score: value.score,
      displayValue: typeof value.display_value === "string"
        ? value.display_value
        : typeof value.displayValue === "string" ? value.displayValue : null,
      estimatedSavingsMs: typeof value.estimated_savings_ms === "number"
        ? value.estimated_savings_ms
        : typeof value.estimatedSavingsMs === "number" ? value.estimatedSavingsMs : null,
    }];
  });
}

export function selectLighthouseFindings(
  categories: Record<string, LighthouseCategoryData> | undefined,
  audits: Record<string, LighthouseAudit> | undefined,
): Record<LighthouseCategory, LighthouseFinding[]> {
  const result = {} as Record<LighthouseCategory, LighthouseFinding[]>;
  for (const category of Object.keys(CATEGORY_LABELS) as LighthouseCategory[]) {
    const findings = (categories?.[category]?.auditRefs ?? []).flatMap((reference) => {
      if (!reference.id) return [];
      const audit = audits?.[reference.id];
      if (
        !audit
        || typeof audit.score !== "number"
        || audit.score >= 0.9
        || audit.scoreDisplayMode === "manual"
        || audit.scoreDisplayMode === "notApplicable"
        || !audit.title
        || !audit.description
      ) return [];
      const description = audit.description
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 700);
      if (!description) return [];
      return [{
        id: reference.id,
        title: audit.title.slice(0, 160),
        description,
        score: audit.score,
        displayValue: audit.displayValue?.slice(0, 120) ?? null,
        estimatedSavingsMs: typeof audit.details?.overallSavingsMs === "number"
          ? Math.max(0, Math.round(audit.details.overallSavingsMs))
          : null,
        weight: typeof reference.weight === "number" ? reference.weight : 0,
      }];
    });
    findings.sort((a, b) => category === "performance"
      ? (b.estimatedSavingsMs ?? 0) - (a.estimatedSavingsMs ?? 0) || b.weight - a.weight
      : b.weight - a.weight);
    result[category] = findings.slice(0, 3).map((finding) => ({
      id: finding.id,
      title: finding.title,
      description: finding.description,
      score: finding.score,
      displayValue: finding.displayValue,
      estimatedSavingsMs: finding.estimatedSavingsMs,
    }));
  }
  return result;
}

export function buildMetricGuidance(
  metadata: Record<string, unknown> | null | undefined,
): MetricGuidance[] {
  if (!metadata) return [];
  const guidance: MetricGuidance[] = [];
  const add = (
    label: string,
    value: number,
    suffix: string,
    goodMax: number,
    poorMin: number,
    action: string,
    targetSuffix = suffix,
  ) => {
    if (!Number.isFinite(value)) return;
    const assessment = value <= goodMax ? "good" : value >= poorMin ? "poor" : "improve";
    if (assessment !== "good") {
      guidance.push({
        label,
        value: `${value}${suffix}`,
        target: `<= ${goodMax}${targetSuffix}`,
        assessment,
        action,
      });
    }
  };

  if (typeof metadata.lcp_ms === "number") {
    add("Largest Contentful Paint", metadata.lcp_ms, " ms", 2500, 4000,
      "Use the LCP element and image audits below to identify the exact large or late-loading content; fix that resource first.");
  }
  if (typeof metadata.inp_ms === "number") {
    add("Interaction to Next Paint", metadata.inp_ms, " ms", 200, 500,
      "Use the long-task and JavaScript audits to find work blocking input; reduce or split that work.");
  }
  if (typeof metadata.cls === "number") {
    add("Cumulative Layout Shift", metadata.cls, "", 0.1, 0.25,
      "Use the layout-shift audit to identify the moving element; reserve its space, especially for images, embeds, and injected content.", "");
  }
  if (typeof metadata.fcp_ms === "number") {
    add("First Contentful Paint", metadata.fcp_ms, " ms", 1800, 3000,
      "Check the render-blocking-resource and server-response audits; they identify what is delaying the first visible content.");
  }
  if (typeof metadata.ttfb_ms === "number") {
    add("Time to First Byte", metadata.ttfb_ms, " ms", 800, 1800,
      "Compare with the uptime response-time history, then check origin/server logs and caching for this same URL and time period.");
  }
  return guidance;
}

export function performanceScoreExplanation(score: number, strategy: "mobile" | "desktop" = "mobile"): string {
  return `Lighthouse ${strategy} lab score: ${score}/100. It is a weighted score of performance audits, not an overall site-health grade. Accessibility, SEO, and best-practices scores are separate and do not lower this performance score.`;
}

export function lighthouseCategoryScore(metadata: Record<string, unknown> | null | undefined, category: LighthouseCategory): number | null {
  const key = category.replaceAll("-", "_") + "_score";
  const score = metadata?.[key];
  return typeof score === "number" && Number.isFinite(score) ? score : null;
}
