import { describe, expect, it } from "vitest";
import { classifyAuthCallbackError } from "@/lib/auth/callback-error";

describe("auth callback error classification", () => {
  it("identifies expired one-time links", () => {
    expect(classifyAuthCallbackError("otp_expired")).toBe("expired");
    expect(classifyAuthCallbackError("The token has expired")).toBe("expired");
  });

  it("identifies redirect and PKCE setup errors", () => {
    expect(classifyAuthCallbackError("redirect_uri_not_allowed")).toBe("configuration");
    expect(classifyAuthCallbackError("flow_state_not_found")).toBe("configuration");
    expect(classifyAuthCallbackError("bad_code_verifier")).toBe("configuration");
  });

  it("keeps unknown callback errors generic", () => {
    expect(classifyAuthCallbackError("invalid token")).toBe("invalid");
    expect(classifyAuthCallbackError(null)).toBe("invalid");
  });
});
