import { describe, expect, it } from "vitest";
import { classifyTeamInviteError } from "@/lib/auth/team-invite-error";

describe("team invitation error classification", () => {
  it("identifies addresses that already have an account", () => {
    expect(classifyTeamInviteError({ code: "email_exists" })).toBe("existing-account");
    expect(classifyTeamInviteError({ code: "user_already_exists" })).toBe("existing-account");
  });

  it("identifies email delivery rate limits", () => {
    expect(classifyTeamInviteError({ code: "over_email_send_rate_limit" })).toBe("rate-limit");
    expect(classifyTeamInviteError({ message: "Email rate limit exceeded" })).toBe("rate-limit");
    expect(classifyTeamInviteError({ status: 429 })).toBe("rate-limit");
  });

  it("keeps other send errors in the generic category", () => {
    expect(classifyTeamInviteError({ code: "smtp_error", status: 500 })).toBe("send-failed");
    expect(classifyTeamInviteError(null)).toBe("send-failed");
  });
});
