import { describe, expect, it } from "vitest";
import { classifyPasswordResetError } from "@/lib/auth/password-reset-error";

describe("password reset error classification", () => {
  it("identifies common delivery setup errors", () => {
    expect(classifyPasswordResetError({ status: 429 })).toBe("rate-limit");
    expect(classifyPasswordResetError({ code: "redirect_to_not_allowed" })).toBe("redirect");
    expect(classifyPasswordResetError({ message: "Error sending recovery email" })).toBe("email-provider");
  });

  it("keeps unrecognized failures generic", () => {
    expect(classifyPasswordResetError(new Error("Unexpected failure"))).toBe("unavailable");
    expect(classifyPasswordResetError(null)).toBe("unavailable");
  });
});
