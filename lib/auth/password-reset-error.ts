export type PasswordResetErrorCategory = "rate-limit" | "redirect" | "email-provider" | "unavailable";

export function classifyPasswordResetError(error: unknown): PasswordResetErrorCategory {
  if (!error || typeof error !== "object") return "unavailable";

  const detail = error as { code?: unknown; message?: unknown; status?: unknown };
  const code = typeof detail.code === "string" ? detail.code.toLowerCase() : "";
  const message = typeof detail.message === "string" ? detail.message.toLowerCase() : "";
  const status = typeof detail.status === "number" ? detail.status : undefined;
  const text = `${code} ${message}`;

  if (status === 429 || text.includes("rate_limit") || text.includes("rate limit")) {
    return "rate-limit";
  }
  if (
    text.includes("redirect_to_not_allowed") ||
    text.includes("redirect url") ||
    text.includes("redirect_uri")
  ) {
    return "redirect";
  }
  if (
    text.includes("smtp") ||
    text.includes("email provider") ||
    text.includes("error sending recovery email")
  ) {
    return "email-provider";
  }
  return "unavailable";
}
