export type TeamInviteErrorCategory = "existing-account" | "send-failed";

export function classifyTeamInviteError(error: unknown): TeamInviteErrorCategory {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return "send-failed";
  }

  const code = error.code;
  return code === "email_exists" || code === "user_already_exists"
    ? "existing-account"
    : "send-failed";
}
