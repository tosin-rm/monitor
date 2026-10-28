export const WORDFENCE_MIN_REQUEST_INTERVAL_MS = 45 * 60_000;
export const WORDFENCE_REFRESH_INTERVAL_MS = 60 * 60_000;
export const WORDFENCE_MAX_BACKOFF_MS = 24 * 60 * 60_000;

export type FeedSyncSchedule = {
  fetched_at: string | null;
  last_attempt_at: string | null;
  retry_after: string | null;
  consecutive_failures: number;
};

export function shouldSyncWordfenceFeed(state: FeedSyncSchedule, now: number): boolean {
  const retryAt = state.retry_after ? Date.parse(state.retry_after) : 0;
  const lastAttemptAt = state.last_attempt_at ? Date.parse(state.last_attempt_at) : 0;
  const fetchedAt = state.fetched_at ? Date.parse(state.fetched_at) : 0;
  return !(retryAt > now || now - lastAttemptAt < WORDFENCE_MIN_REQUEST_INTERVAL_MS || now - fetchedAt < WORDFENCE_REFRESH_INTERVAL_MS);
}

export function wordfenceRetryDelayMs(state: FeedSyncSchedule, retryAfter: string | null, now: number): number {
  let providerDelay: number | null = null;
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) providerDelay = seconds * 1000;
    else {
      const date = Date.parse(retryAfter);
      if (Number.isFinite(date)) providerDelay = Math.max(0, date - now);
    }
  }
  if (providerDelay !== null) return Math.max(WORDFENCE_MIN_REQUEST_INTERVAL_MS, providerDelay);
  const exponent = Math.max(0, Math.min(10, state.consecutive_failures));
  return Math.min(WORDFENCE_MAX_BACKOFF_MS, WORDFENCE_MIN_REQUEST_INTERVAL_MS * (2 ** exponent));
}
