import { describe, expect, it } from "vitest";
import { assessCertificate } from "@/lib/ssl/inspect";

const now = new Date("2025-01-01T00:00:00.000Z");

describe("certificate assessment", () => {
  it("accepts a trusted, hostname-matched certificate and reports time remaining", () => {
    expect(assessCertificate({
      authorized: true,
      handshakeOk: true,
      hostnameMatches: true,
      validFrom: "2024-12-01T00:00:00.000Z",
      validTo: "2025-01-03T00:00:00.000Z",
      now,
    })).toMatchObject({
      success: true,
      daysRemaining: 2,
      errorCode: null,
    });
  });

  it("classifies expired, mismatched, untrusted, and not-yet-valid certificates", () => {
    const shared = {
      handshakeOk: false,
      validFrom: "2024-01-01T00:00:00.000Z",
      validTo: "2024-12-31T00:00:00.000Z",
      now,
    };
    expect(assessCertificate({
      ...shared,
      authorized: false,
      hostnameMatches: true,
    })).toMatchObject({ success: false, errorCode: "expired", daysRemaining: -1 });
    expect(assessCertificate({
      ...shared,
      authorized: false,
      hostnameMatches: false,
    }).errorCode).toBe("hostname_mismatch");
    expect(assessCertificate({
      ...shared,
      authorized: false,
      hostnameMatches: true,
      validTo: "2025-02-01T00:00:00.000Z",
    }).errorCode).toBe("untrusted");
    expect(assessCertificate({
      ...shared,
      authorized: false,
      hostnameMatches: true,
      validFrom: "2025-01-02T00:00:00.000Z",
      validTo: "2025-02-01T00:00:00.000Z",
    }).errorCode).toBe("not_yet_valid");
  });
});
