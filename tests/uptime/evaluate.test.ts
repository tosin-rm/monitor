import { describe, expect, it } from "vitest";
import {
  classifyWorkerVsSiteFailure,
  isExpectedStatus,
  nextFailureCount,
  shouldOpenIncident,
  shouldResolveIncident,
} from "@/lib/uptime/evaluate";

describe("uptime incident thresholds", () => {
  it("opens one incident after the configured consecutive failure threshold", () => {
    expect(nextFailureCount(1, { success: false, httpStatus: 503 })).toBe(2);
    expect(shouldOpenIncident({ consecutiveFailures: 1, threshold: 2, hasOpenIncident: false })).toBe(false);
    expect(shouldOpenIncident({ consecutiveFailures: 2, threshold: 2, hasOpenIncident: false })).toBe(true);
    expect(shouldOpenIncident({ consecutiveFailures: 4, threshold: 2, hasOpenIncident: true })).toBe(false);
  });

  it("resets failures and resolves an existing incident on recovery", () => {
    const recovered = { success: true, httpStatus: 200 };
    expect(nextFailureCount(3, recovered)).toBe(0);
    expect(shouldResolveIncident({ hasOpenIncident: true, observation: recovered })).toBe(true);
    expect(shouldResolveIncident({ hasOpenIncident: false, observation: recovered })).toBe(false);
    expect(isExpectedStatus(204, [200, 204])).toBe(true);
    expect(isExpectedStatus(500, [200, 204])).toBe(false);
  });

  it("distinguishes checker errors from remote-site failures", () => {
    expect(classifyWorkerVsSiteFailure("worker_error")).toBe("monitor");
    expect(classifyWorkerVsSiteFailure("timeout")).toBe("site");
    expect(classifyWorkerVsSiteFailure("hostname_mismatch")).toBe("site");
  });
});
