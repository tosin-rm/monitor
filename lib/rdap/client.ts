import { normalizeDomain } from "@/lib/urls";
import { classifyRdapHttp, parseRdapExpiry, type RdapLookupResult } from "@/lib/rdap/parse";

export type RdapBootstrap = {
  services: Array<[string[], string[]]>;
};

export type RdapFetcher = (url: string) => Promise<{ status: number; json: unknown }>;

const IANA_BOOTSTRAP = "https://data.iana.org/rdap/dns.json";

function tldOf(domain: string): string {
  return domain.split(".").pop() ?? domain;
}

function rdapBaseFor(domain: string, bootstrap: RdapBootstrap): string | null {
  const tld = tldOf(domain);
  for (const [tlds, urls] of bootstrap.services) {
    if (tlds.some((item) => item.toLowerCase() === tld || item.toLowerCase() === domain)) {
      const base = urls[0];
      return base ? base.replace(/\/$/, "") : null;
    }
  }
  return null;
}

export async function lookupDomainExpiry(options: {
  domain: string;
  fetchImpl: RdapFetcher;
  bootstrap?: RdapBootstrap;
  now?: Date;
}): Promise<RdapLookupResult> {
  const retrievedAt = (options.now ?? new Date()).toISOString();
  const domain = normalizeDomain(options.domain);
  try {
    const bootstrap =
      options.bootstrap ??
      ((await options.fetchImpl(IANA_BOOTSTRAP)).json as RdapBootstrap);
    const base = rdapBaseFor(domain, bootstrap);
    if (!base) {
      return { status: "unsupported", expiryDate: null, retrievedAt, confidence: "none" };
    }
    const response = await options.fetchImpl(`${base}/domain/${encodeURIComponent(domain)}`);
    const classified = classifyRdapHttp(response.status);
    if (classified) {
      return { status: classified, expiryDate: null, retrievedAt, confidence: "none" };
    }
    if (response.status < 200 || response.status >= 300) {
      return { status: "network_failure", expiryDate: null, retrievedAt, confidence: "none" };
    }
    return { ...parseRdapExpiry(response.json), retrievedAt };
  } catch (error) {
    if ((error as Error).message?.includes("valid domain")) {
      return { status: "invalid_response", expiryDate: null, retrievedAt, confidence: "none" };
    }
    return { status: "network_failure", expiryDate: null, retrievedAt, confidence: "none" };
  }
}

export function shouldReplaceExpiry(options: {
  currentDate: string | null;
  manualOverride: boolean;
  incoming: RdapLookupResult;
}): { nextDate: string | null; replaced: boolean } {
  if (options.incoming.status !== "ok" || !options.incoming.expiryDate) {
    return { nextDate: options.currentDate, replaced: false };
  }
  if (options.manualOverride && options.currentDate) {
    return { nextDate: options.currentDate, replaced: false };
  }
  return { nextDate: options.incoming.expiryDate, replaced: options.currentDate !== options.incoming.expiryDate };
}
