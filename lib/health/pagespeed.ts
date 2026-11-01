import { selectLighthouseFindings } from "@/lib/health/performance-guidance";
import { createAdminClient } from "@/lib/supabase/admin";

type PerformanceStrategy = "mobile" | "desktop";

type PageSpeedMetric = { percentile?: number; category?: string };
type CruxMetric = { percentiles?: { p75?: number } };

type LighthouseResponse = {
  lighthouseResult?: {
    categories?: Record<string, {
      score?: number;
      auditRefs?: Array<{ id?: string; weight?: number }>;
    }>;
    audits?: Record<string, {
      numericValue?: number;
      score?: number | null;
      scoreDisplayMode?: string;
      title?: string;
      description?: string;
      displayValue?: string;
      details?: { overallSavingsMs?: number };
    }>;
  };
  loadingExperience?: { metrics?: Record<string, PageSpeedMetric> };
  originLoadingExperience?: { metrics?: Record<string, PageSpeedMetric> };
};

function metricNumber(metric: PageSpeedMetric | undefined): number | null {
  return typeof metric?.percentile === "number" && Number.isFinite(metric.percentile)
    ? Math.round(metric.percentile * 100) / 100
    : null;
}

function cruxNumber(metric: CruxMetric | undefined): number | null {
  return typeof metric?.percentiles?.p75 === "number" && Number.isFinite(metric.percentiles.p75)
    ? metric.percentiles.p75
    : null;
}

async function readCruxFieldData(url: string, apiKey: string, strategy: PerformanceStrategy): Promise<{
  lcp_ms: number | null;
  inp_ms: number | null;
  cls: number | null;
  fcp_ms: number | null;
  ttfb_ms: number | null;
} | null> {
  try {
    const response = await fetch(`https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url,
        formFactor: strategy === "mobile" ? "PHONE" : "DESKTOP",
        metrics: ["largest_contentful_paint", "interaction_to_next_paint", "cumulative_layout_shift", "first_contentful_paint", "experimental_time_to_first_byte"],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const payload = await response.json() as { record?: { metrics?: Record<string, CruxMetric> } };
    const metrics = payload.record?.metrics;
    if (!metrics || !Object.keys(metrics).length) return null;
    return {
      lcp_ms: cruxNumber(metrics.largest_contentful_paint),
      inp_ms: cruxNumber(metrics.interaction_to_next_paint),
      cls: cruxNumber(metrics.cumulative_layout_shift),
      fcp_ms: cruxNumber(metrics.first_contentful_paint),
      ttfb_ms: cruxNumber(metrics.experimental_time_to_first_byte),
    };
  } catch {
    return null;
  }
}

export async function checkWebsitePerformance(
  admin: ReturnType<typeof createAdminClient>,
  website: { id: string; organization_id: string; primary_url: string },
  now: Date,
  strategy: PerformanceStrategy,
  apiKey?: string,
): Promise<{ success: boolean }> {
  const checkedAt = now.toISOString();
  let success = false;
  let errorCode: string | null = null;
  let sanitizedError: string | null = null;
  const metadata: Record<string, unknown> = {
    provider: "pagespeed_insights",
    strategy,
    requested_url: website.primary_url,
    performance_score: null,
    accessibility_score: null,
    best_practices_score: null,
    seo_score: null,
    lcp_ms: null,
    inp_ms: null,
    cls: null,
    fcp_ms: null,
    ttfb_ms: null,
    field_data_available: 0,
  };

  try {
    const url = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
    url.searchParams.set("url", website.primary_url);
    url.searchParams.set("strategy", strategy);
    for (const category of ["performance", "accessibility", "best-practices", "seo"]) {
      url.searchParams.append("category", category);
    }
    if (apiKey) url.searchParams.set("key", apiKey);
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) {
      errorCode = response.status === 429 ? "provider_rate_limited" : "provider_unavailable";
      sanitizedError = response.status === 429
        ? "Performance provider rate limit reached"
        : "Performance provider could not complete the scan";
    } else {
      const payload = await response.json() as LighthouseResponse;
      const lighthouse = payload.lighthouseResult;
      if (!lighthouse?.categories || !lighthouse.audits) {
        errorCode = "invalid_provider_response";
        sanitizedError = "Performance provider returned incomplete results";
      } else {
        const score = (key: string) => {
          const value = lighthouse.categories?.[key]?.score;
          return typeof value === "number" ? Math.round(value * 100) : null;
        };
        const audit = (key: string) => {
          const value = lighthouse.audits?.[key]?.numericValue;
          return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
        };
        const field = payload.loadingExperience?.metrics ?? payload.originLoadingExperience?.metrics;
        const crux = apiKey ? await readCruxFieldData(website.primary_url, apiKey, strategy) : null;
        const lcp = metricNumber(field?.LARGEST_CONTENTFUL_PAINT_MS);
        const inp = metricNumber(field?.INTERACTION_TO_NEXT_PAINT);
        const clsValue = metricNumber(field?.CUMULATIVE_LAYOUT_SHIFT_SCORE);
        const cls = clsValue === null ? null : clsValue / 100;
        const fcp = metricNumber(field?.FIRST_CONTENTFUL_PAINT_MS);
        const ttfb = metricNumber(field?.EXPERIMENTAL_TIME_TO_FIRST_BYTE);
        Object.assign(metadata, {
          performance_score: score("performance"),
          accessibility_score: score("accessibility"),
          best_practices_score: score("best-practices"),
          seo_score: score("seo"),
          category_findings: selectLighthouseFindings(lighthouse.categories, lighthouse.audits),
          lcp_ms: crux?.lcp_ms ?? lcp ?? audit("largest-contentful-paint"),
          inp_ms: crux?.inp_ms ?? inp,
          cls: crux?.cls ?? cls ?? audit("cumulative-layout-shift"),
          fcp_ms: crux?.fcp_ms ?? fcp ?? audit("first-contentful-paint"),
          ttfb_ms: crux?.ttfb_ms ?? ttfb,
          field_data_available: Number(Boolean(crux || field && Object.keys(field).length)),
        });
        success = true;
      }
    }
  } catch {
    errorCode = "provider_request_failed";
    sanitizedError = "Performance provider request failed or timed out";
  }

  const { error } = await admin.from("check_results").insert({
    organization_id: website.organization_id,
    website_id: website.id,
    check_type: "performance",
    checked_at: checkedAt,
    success,
    error_code: errorCode,
    sanitized_error_message: sanitizedError,
    metadata,
  });
  if (error) throw error;

  const timestampUpdate = strategy === "mobile"
    ? { performance_checked_at: checkedAt }
    : { performance_desktop_checked_at: checkedAt };
  const { error: updateError } = await admin.from("websites")
    .update(timestampUpdate)
    .eq("id", website.id)
    .eq("organization_id", website.organization_id);
  if (updateError) throw updateError;
  return { success };
}
