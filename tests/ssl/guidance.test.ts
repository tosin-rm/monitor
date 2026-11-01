import { describe, expect, it } from "vitest";
import { certificateGuidance, isConfirmedCertificateProblem } from "@/lib/ssl/guidance";

describe("certificate guidance", () => {
  it("provides a concrete fix for confirmed certificate problems", () => {
    expect(certificateGuidance("hostname_mismatch", false)).toMatchObject({
      status: "invalid",
      title: "Certificate hostname does not match",
      action: expect.stringContaining("www vs. apex"),
    });
    expect(isConfirmedCertificateProblem("expired")).toBe(true);
    expect(isConfirmedCertificateProblem("hostname_mismatch")).toBe(true);
  });

  it("does not describe transport failures as invalid certificates", () => {
    expect(certificateGuidance("timeout", false)).toMatchObject({
      status: "unconfirmed",
      title: "Monitor could not confirm the certificate",
      action: expect.stringContaining("does not prove the certificate is invalid"),
    });
    expect(isConfirmedCertificateProblem("timeout")).toBe(false);
  });

  it("explains a successful certificate check", () => {
    expect(certificateGuidance(null, true).status).toBe("valid");
  });
});
