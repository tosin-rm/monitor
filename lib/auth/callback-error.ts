export type AuthCallbackError = "expired" | "configuration" | "invalid";

export function classifyAuthCallbackError(value: string | null | undefined): AuthCallbackError {
  const code = value?.toLowerCase() ?? "";
  if (
    code.includes("expired") ||
    code.includes("otp_expired") ||
    code.includes("token_expired")
  ) {
    return "expired";
  }
  if (
    code.includes("redirect") ||
    code.includes("code_verifier") ||
    code.includes("pkce") ||
    code.includes("flow_state")
  ) {
    return "configuration";
  }
  return "invalid";
}
