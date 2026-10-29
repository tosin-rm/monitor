import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { RequestOptions } from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import type { LookupFunction } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { DnsLookup, ResolvedAddress, SafeUrl } from "@/lib/ssrf/validate";
import {
  MAX_REDIRECTS,
  MAX_RESPONSE_BYTES,
  SsrfError,
  validateDestination,
} from "@/lib/ssrf/validate";

export const nodeDnsLookup: DnsLookup = async (hostname) => {
  const family = isIP(hostname);
  if (family === 4 || family === 6) {
    return [{ address: hostname, family }];
  }
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  return records.map((record) => ({
    address: record.address,
    family: record.family === 6 ? 6 : 4,
  }));
};

export type SafeFetchResult = {
  status: number;
  responseTimeMs: number;
  finalUrl: string;
  bodyPreview: string;
  redirected: boolean;
};

type TransportResponse = {
  status: number;
  location: string | null;
  bodyPreview: string;
};

type SafeTransport = (options: {
  safe: SafeUrl;
  address: ResolvedAddress;
  timeoutMs: number;
}) => Promise<TransportResponse>;

function nodeTransport(options: {
  safe: SafeUrl;
  address: ResolvedAddress;
  timeoutMs: number;
}): Promise<TransportResponse> {
  return new Promise((resolve, reject) => {
    const { safe, address, timeoutMs } = options;
    const requestOptions: RequestOptions = {
      protocol: safe.url.protocol,
      hostname: safe.hostname,
      port: safe.port,
      path: `${safe.url.pathname}${safe.url.search}`,
      method: "GET",
      headers: {
        Host: safe.hostname.includes(":") ? `[${safe.hostname}]` : safe.hostname,
        Accept: "text/html,application/json;q=0.9,*/*;q=0.1",
        "User-Agent": "MonitorUptime/1.0",
        Connection: "close",
      },
      lookup: ((hostname: string, _lookupOptions: unknown, callback: (error: NodeJS.ErrnoException | null, address: string, family: number) => void) => {
        if (hostname !== safe.hostname) {
          callback(new Error("Unexpected DNS lookup hostname"), "", 0);
          return;
        }
        callback(null, address.address, address.family);
      }) as LookupFunction,
      ...(safe.url.protocol === "https:" ? { servername: safe.hostname } : {}),
    };
    const request = (safe.url.protocol === "https:" ? httpsRequest : httpRequest)(
      requestOptions,
      (response) => {
        readResponse(response, request, resolve, reject);
      },
    );
    const timer = setTimeout(() => {
      request.destroy(new SsrfError("timeout", "Request timed out"));
    }, timeoutMs);
    request.once("error", (error) => {
      clearTimeout(timer);
      reject(error instanceof SsrfError ? error : new SsrfError("network_failure", "Request failed"));
    });
    request.once("close", () => clearTimeout(timer));
    request.end();
  });
}

function readResponse(
  response: IncomingMessage,
  request: ClientRequest,
  resolve: (value: TransportResponse) => void,
  reject: (reason: Error) => void,
): void {
  const chunks: Buffer[] = [];
  let received = 0;
  response.on("data", (chunk: Buffer | string) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += bytes.length;
    if (received > MAX_RESPONSE_BYTES) {
      request.destroy(new SsrfError("response_too_large", "Response exceeded size limit"));
      reject(new SsrfError("response_too_large", "Response exceeded size limit"));
      return;
    }
    chunks.push(bytes);
  });
  response.once("error", () => reject(new SsrfError("network_failure", "Response could not be read")));
  response.once("end", () => {
    resolve({
      status: response.statusCode ?? 0,
      location: typeof response.headers.location === "string" ? response.headers.location : null,
      bodyPreview: Buffer.concat(chunks).toString("utf8").slice(0, 512),
    });
  });
}

export async function safeHttpCheck(options: {
  url: string;
  timeoutMs: number;
  followRedirects: boolean;
  maxRedirects?: number;
  lookup?: DnsLookup;
  transport?: SafeTransport;
}): Promise<SafeFetchResult> {
  const lookup = options.lookup ?? nodeDnsLookup;
  const transport = options.transport ?? nodeTransport;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  let current = options.url;
  let redirected = false;
  const started = Date.now();
  const deadline = started + options.timeoutMs;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new SsrfError("timeout", "Request timed out");
    const safe = await validateDestination(current, lookup, remainingMs);
    if (!safe.addresses.length) throw new SsrfError("dns_failure", "No resolved address");
    // Prefer IPv4 because some hosted workers have no outbound IPv6 route. Keep
    // every candidate pinned to the already validated DNS answers.
    const addresses = [...safe.addresses].sort((left, right) => left.family - right.family);
    let response: TransportResponse | null = null;
    let lastConnectionError: SsrfError | null = null;
    for (let index = 0; index < addresses.length; index += 1) {
      const budget = deadline - Date.now();
      if (budget <= 0) throw new SsrfError("timeout", "Request timed out");
      const addressesLeft = addresses.length - index;
      const attemptTimeoutMs = Math.max(1, Math.floor(budget / addressesLeft));
      try {
        response = await transport({ safe, address: addresses[index]!, timeoutMs: attemptTimeoutMs });
        break;
      } catch (error) {
        if (error instanceof SsrfError && (error.code === "network_failure" || error.code === "timeout")) {
          lastConnectionError = error;
          continue;
        }
        throw error;
      }
    }
    if (!response) throw lastConnectionError ?? new SsrfError("network_failure", "Request failed");
    try {
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (!options.followRedirects) {
          return {
            status: response.status,
            responseTimeMs: Date.now() - started,
            finalUrl: current,
            bodyPreview: response.bodyPreview,
            redirected,
          };
        }
        if (!response.location) {
          throw new SsrfError("invalid_redirect", "Redirect missing Location header");
        }
        current = new URL(response.location, safe.url).toString();
        redirected = true;
        if (hop === maxRedirects) {
          throw new SsrfError("too_many_redirects", "Exceeded redirect limit");
        }
        continue;
      }
      return {
        status: response.status,
        responseTimeMs: Date.now() - started,
        finalUrl: current,
        bodyPreview: response.bodyPreview,
        redirected,
      };
    } catch (error) {
      if (error instanceof SsrfError) throw error;
      throw new SsrfError("network_failure", "Request failed");
    }
  }
  throw new SsrfError("too_many_redirects", "Exceeded redirect limit");
}
