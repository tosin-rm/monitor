export type TeamInviteErrorCategory = "existing-account" | "rate-limit" | "send-failed";

export function classifyTeamInviteError(error: unknown): TeamInviteErrorCategory {
  if (!error || typeof error !== "object") return "send-failed";

  const details = error as { code?: unknown; message?: unknown; status?: unknown };
  const code = typeof details.code === "string" ? details.code.toLowerCase() : "";
  const message = typeof details.message === "string" ? details.message.toLowerCase() : "";

  if (code === "email_exists" || code === "user_already_exists") return "existing-account";
  if (
    details.status === 429 ||
    code.includes("rate_limit") ||
    message.includes("rate limit")
  ) {
    return "rate-limit";
  }
  return "send-failed";
}
