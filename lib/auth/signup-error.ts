export type SignupErrorCategory =
  | "rate-limit"
  | "password"
  | "email"
  | "disabled"
  | "unavailable";

export function classifySignupError(error: unknown): SignupErrorCategory {
  if (!error || typeof error !== "object") return "unavailable";

  const detail = error as { code?: unknown; message?: unknown; status?: unknown };
  const code = typeof detail.code === "string" ? detail.code.toLowerCase() : "";
  const message = typeof detail.message === "string" ? detail.message.toLowerCase() : "";
  const status = typeof detail.status === "number" ? detail.status : undefined;
  const text = `${code} ${message}`;

  if (
    status === 429 ||
    text.includes("rate_limit") ||
    text.includes("rate limit") ||
    text.includes("over_email_send_rate_limit")
  ) {
    return "rate-limit";
  }
  if (text.includes("weak_password") || text.includes("password should")) {
    return "password";
  }
  if (text.includes("email_address_invalid") || text.includes("invalid email")) {
    return "email";
  }
  if (text.includes("signup_disabled") || text.includes("signups not allowed")) {
    return "disabled";
  }
  return "unavailable";
}
