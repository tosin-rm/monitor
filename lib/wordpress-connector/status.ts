export function isSecurityDataStale(timestamp: string | null | undefined, evaluatedAt: string, maxAgeMs: number): boolean {
  if (!timestamp) return true;
  const checkedAt = new Date(timestamp).getTime();
  const referenceTime = new Date(evaluatedAt).getTime();
  return !Number.isFinite(checkedAt) || !Number.isFinite(referenceTime) || referenceTime - checkedAt > maxAgeMs;
}

export function isConnectorReportStale(timestamp: string | null): boolean {
  if (!timestamp) return true;
  return Date.now() - new Date(timestamp).getTime() > 24 * 60 * 60_000;
}

// PostgreSQL unique_violation is raised by the connector report and nonce
// unique constraints when a signed request ID is replayed.
export function isConnectorReplayError(code: string | undefined): boolean {
  return code === "23505";
}
