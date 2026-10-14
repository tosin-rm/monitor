export type RdapLookupStatus =
  | "ok"
  | "missing_expiry"
  | "unsupported"
  | "rate_limited"
  | "invalid_response"
  | "network_failure"
  | "not_found";

export type RdapLookupResult = {
  status: RdapLookupStatus;
  expiryDate: string | null;
  retrievedAt: string;
  confidence: "high" | "medium" | "low" | "none";
};

const EXPIRY_ACTIONS = new Set(["expiration", "registration expiration", "expire"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toIsoDate(value: string): string | null {
  const instant = Date.parse(value);
  if (Number.isNaN(instant)) return null;
  return new Date(instant).toISOString().slice(0, 10);
}

export function parseRdapExpiry(payload: unknown): Omit<RdapLookupResult, "retrievedAt"> {
  if (!isRecord(payload)) {
    return { status: "invalid_response", expiryDate: null, confidence: "none" };
  }
  const events = payload.events;
  if (!Array.isArray(events)) {
    return { status: "missing_expiry", expiryDate: null, confidence: "none" };
  }
  const expiryEvents = events
    .filter(isRecord)
    .filter((event) => typeof event.eventAction === "string" && EXPIRY_ACTIONS.has(event.eventAction.toLowerCase()))
    .map((event) => (typeof event.eventDate === "string" ? toIsoDate(event.eventDate) : null))
    .filter((value): value is string => Boolean(value))
    .sort();
  const expiryDate = expiryEvents.at(-1) ?? null;
  if (!expiryDate) {
    return { status: "missing_expiry", expiryDate: null, confidence: "none" };
  }
  return { status: "ok", expiryDate, confidence: "medium" };
}

export function classifyRdapHttp(status: number): RdapLookupStatus | null {
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status === 400 || status === 422) return "invalid_response";
  if (status === 501) return "unsupported";
  if (status >= 500) return "network_failure";
  return null;
}
