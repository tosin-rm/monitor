const DATE_SOURCE_LABELS: Record<string, string> = {
  manual: "Manual entry",
  rdap: "RDAP domain registry",
  provider_api: "Provider API",
  certificate_inspection: "Live TLS certificate inspection",
  unknown: "Unknown source",
};

export function assetDateSourceLabel(source: string | null | undefined): string {
  return source ? DATE_SOURCE_LABELS[source] ?? "Unknown source" : "Unknown source";
}
