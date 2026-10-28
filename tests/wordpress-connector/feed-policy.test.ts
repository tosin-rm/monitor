import { describe, expect, it } from "vitest";
import { shouldSyncWordfenceFeed, wordfenceRetryDelayMs, WORDFENCE_MIN_REQUEST_INTERVAL_MS, WORDFENCE_REFRESH_INTERVAL_MS } from "@/lib/wordpress-connector/feed-policy";

const now = Date.parse("2026-10-23T12:00:00.000Z");

describe("Wordfence feed schedule guard", () => {
  it("permits the first sync and then requires an hour between successful feed refreshes", () => {
    expect(shouldSyncWordfenceFeed({ fetched_at: null, last_attempt_at: null, retry_after: null, consecutive_failures: 0 }, now)).toBe(true);
    expect(shouldSyncWordfenceFeed({ fetched_at: new Date(now - WORDFENCE_REFRESH_INTERVAL_MS + 1).toISOString(), last_attempt_at: null, retry_after: null, consecutive_failures: 0 }, now)).toBe(false);
    expect(shouldSyncWordfenceFeed({ fetched_at: new Date(now - WORDFENCE_REFRESH_INTERVAL_MS - 1).toISOString(), last_attempt_at: null, retry_after: null, consecutive_failures: 0 }, now)).toBe(true);
  });

  it("prevents manual retries inside the local minimum interval and honors retry_after", () => {
    expect(shouldSyncWordfenceFeed({ fetched_at: null, last_attempt_at: new Date(now - WORDFENCE_MIN_REQUEST_INTERVAL_MS + 1).toISOString(), retry_after: null, consecutive_failures: 0 }, now)).toBe(false);
    expect(shouldSyncWordfenceFeed({ fetched_at: null, last_attempt_at: null, retry_after: new Date(now + 60_000).toISOString(), consecutive_failures: 0 }, now)).toBe(false);
  });

  it("uses provider Retry-After with a 45-minute floor and exponential backoff otherwise", () => {
    const empty = { fetched_at: null, last_attempt_at: null, retry_after: null, consecutive_failures: 0 };
    expect(wordfenceRetryDelayMs(empty, "10", now)).toBe(WORDFENCE_MIN_REQUEST_INTERVAL_MS);
    expect(wordfenceRetryDelayMs(empty, "7200", now)).toBe(7_200_000);
    expect(wordfenceRetryDelayMs({ ...empty, consecutive_failures: 2 }, null, now)).toBe(180 * 60_000);
  });
});
