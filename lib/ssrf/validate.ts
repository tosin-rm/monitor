import { ALLOWED_PORTS, isBlockedHostname, isBlockedIp } from "@/lib/ssrf/ip";

export type ResolvedAddress = { address: string; family: 4 | 6 };

export type DnsLookup = (hostname: string) => Promise<ResolvedAddress[]>;

export type SafeUrl = {
  url: URL;
  hostname: string;
  port: number;
  addresses: ResolvedAddress[];
};

const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_REDIRECTS = 3;

export class SsrfError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "SsrfError";
  }
}

export function parsePublicHttpUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new SsrfError("invalid_url", "URL could not be parsed");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfError("invalid_protocol", "Only HTTP and HTTPS are allowed");
  }
  if (url.username || url.password) {
    throw new SsrfError("credentials_forbidden", "URLs must not include credentials");
  }
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (!ALLOWED_PORTS.has(port)) {
    throw new SsrfError("invalid_port", "Only ports 80 and 443 are allowed");
  }
  if (isBlockedHostname(url.hostname) || isBlockedIp(url.hostname)) {
    throw new SsrfError("blocked_host", "Destination host is not allowed");
  }
  return url;
}

export async function validateDestination(
  input: string,
  lookup: DnsLookup,
  timeoutMs = 10_000,
): Promise<SafeUrl> {
  const url = parsePublicHttpUrl(input);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  let addresses: ResolvedAddress[];
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    addresses = await Promise.race([
      lookup(hostname),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new SsrfError("timeout", "DNS lookup timed out")),
          timeoutMs,
        );
      }),
    ]);
  } catch (error) {
    if (error instanceof SsrfError) throw error;
    throw new SsrfError("dns_failure", "DNS lookup failed");
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  if (!addresses.length) {
    throw new SsrfError("dns_failure", "DNS lookup returned no addresses");
  }
  for (const record of addresses) {
    if (isBlockedIp(record.address)) {
      throw new SsrfError("blocked_ip", "Resolved address is not allowed");
    }
  }
  return { url, hostname, port, addresses };
}

export { MAX_REDIRECTS, MAX_RESPONSE_BYTES };
