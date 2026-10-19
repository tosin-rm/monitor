import { describe, expect, it } from "vitest";
import { classifySignupError } from "@/lib/auth/signup-error";

describe("signup error classification", () => {
  it("explains email delivery rate limits", () => {
    expect(classifySignupError({ code: "over_email_send_rate_limit" })).toBe("rate-limit");
    expect(classifySignupError({ status: 429, message: "Too many requests" })).toBe("rate-limit");
  });

  it("categorizes common Auth configuration and validation errors", () => {
    expect(classifySignupError({ code: "weak_password" })).toBe("password");
    expect(classifySignupError({ message: "Invalid email address" })).toBe("email");
    expect(classifySignupError({ code: "signup_disabled" })).toBe("disabled");
  });

  it("does not expose unclassified or account-existence errors", () => {
    expect(classifySignupError({ code: "user_already_exists" })).toBe("unavailable");
    expect(classifySignupError(new Error("Unexpected failure"))).toBe("unavailable");
    expect(classifySignupError(null)).toBe("unavailable");
  });
});
