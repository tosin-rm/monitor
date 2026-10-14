import { describe, expect, it } from "vitest";
import { retryFailureUpdate } from "@/lib/notifications/retry";

describe("notification retry policy", () => {
  const now = new Date("2025-01-01T00:00:00.000Z");

  it("backs off retryable provider failures exponentially", () => {
    expect(retryFailureUpdate({
      result: { ok: false, retryable: true, errorCode: "rate_limited", sanitizedError: "Provider busy" },
      attempts: 1,
      maxAttempts: 8,
      now,
    })).toEqual({
      status: "failed",
      retryable: true,
      next_attempt_at: "2025-01-01T00:00:30.000Z",
    });
    expect(retryFailureUpdate({
      result: { ok: false, retryable: true, errorCode: "network_failure", sanitizedError: "Unavailable" },
      attempts: 3,
      maxAttempts: 8,
      now,
    }).next_attempt_at).toBe("2025-01-01T00:02:00.000Z");
  });

  it("does not retry permanent, ambiguous, or exhausted failures", () => {
    expect(retryFailureUpdate({
      result: { ok: false, retryable: false, errorCode: "invalid", sanitizedError: "Invalid recipient" },
      attempts: 1,
      maxAttempts: 8,
      now,
    }).retryable).toBe(false);
    expect(retryFailureUpdate({
      result: { ok: false, retryable: true, errorCode: "network_failure", sanitizedError: "Unknown" },
      attempts: 8,
      maxAttempts: 8,
      now,
    }).retryable).toBe(false);
  });
});
