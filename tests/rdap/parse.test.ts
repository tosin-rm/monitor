import { describe, expect, it, vi } from "vitest";
import { lookupDomainExpiry } from "@/lib/rdap/client";
import { parseRdapExpiry } from "@/lib/rdap/parse";

describe("RDAP expiry discovery", () => {
  it("uses the relevant registration expiry event and ignores malformed events", () => {
    expect(parseRdapExpiry({
      events: [
        { eventAction: "registration", eventDate: "2025-01-01T00:00:00Z" },
        { eventAction: "expiration", eventDate: "2026-05-10T12:00:00Z" },
        { eventAction: "expiration", eventDate: "invalid" },
      ],
    })).toEqual({ status: "ok", expiryDate: "2026-05-10", confidence: "medium" });
  });

  it("distinguishes missing and invalid expiry events", () => {
    expect(parseRdapExpiry({ events: [{ eventAction: "registration", eventDate: "2025-01-01" }] }))
      .toMatchObject({ status: "missing_expiry", expiryDate: null });
    expect(parseRdapExpiry(null)).toMatchObject({ status: "invalid_response", expiryDate: null });
  });

  it("classifies unsupported, rate-limited, and network results without replacing dates", async () => {
    const fetchImpl = vi.fn(async () => ({ status: 429, json: {} }));
    const result = await lookupDomainExpiry({
      domain: "example.com",
      fetchImpl,
      bootstrap: { services: [[["com"], ["https://rdap.example"]]] },
      now: new Date("2025-01-01T00:00:00.000Z"),
    });
    expect(result.status).toBe("rate_limited");
    expect(result.expiryDate).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
