import "server-only";

import { request as httpsRequest } from "node:https";
import type { RequestOptions } from "node:https";
import type { LookupFunction } from "node:net";
import { nodeDnsLookup } from "@/lib/ssrf/safe-fetch";
import { SsrfError, validateDestination } from "@/lib/ssrf/validate";

const MAX_RDAP_RESPONSE_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 8_000;

export async function safeRdapFetch(url: string): Promise<{ status: number; json: unknown }> {
  const safe = await validateDestination(url, nodeDnsLookup, REQUEST_TIMEOUT_MS);
  if (safe.url.protocol !== "https:" || safe.port !== 443) {
    throw new SsrfError("invalid_protocol", "RDAP endpoints must use HTTPS on port 443");
  }
  const addresses = [...safe.addresses].sort((left, right) => left.family - right.family);
  let lastError: unknown;

  for (const address of addresses) {
    try {
      return await new Promise((resolve, reject) => {
        const requestOptions: RequestOptions = {
          hostname: safe.hostname,
          port: safe.port,
          path: `${safe.url.pathname}${safe.url.search}`,
          method: "GET",
          headers: {
            Accept: "application/rdap+json, application/json",
            "User-Agent": "MonitorAssetExpiry/1.0",
            Connection: "close",
          },
          lookup: ((hostname: string, lookupOptions: { all?: boolean }, callback: (
            error: NodeJS.ErrnoException | null,
            address: string | Array<{ address: string; family: number }>,
            family?: number,
          ) => void) => {
            if (hostname !== safe.hostname) {
              callback(new Error("Unexpected DNS lookup hostname"), "");
              return;
            }
            if (lookupOptions?.all) callback(null, [{ address: address.address, family: address.family }]);
            else callback(null, address.address, address.family);
          }) as LookupFunction,
          servername: safe.hostname,
        };
        const request = httpsRequest(requestOptions, (response) => {
          const status = response.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            response.destroy();
            resolve({ status, json: null });
            return;
          }
          const chunks: Buffer[] = [];
          let bytes = 0;
          response.on("data", (chunk: Buffer | string) => {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            bytes += buffer.length;
            if (bytes > MAX_RDAP_RESPONSE_BYTES) {
              response.destroy(new SsrfError("response_too_large", "RDAP response exceeded the size limit"));
              return;
            }
            chunks.push(buffer);
          });
          response.once("end", () => {
            try {
              resolve({ status, json: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown });
            } catch {
              reject(new SsrfError("invalid_response", "RDAP response was not valid JSON"));
            }
          });
          response.once("error", reject);
        });
        const timer = setTimeout(() => {
          request.destroy(new SsrfError("timeout", "RDAP request timed out"));
        }, REQUEST_TIMEOUT_MS);
        request.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        request.once("close", () => clearTimeout(timer));
        request.end();
      });
    } catch (error) {
      lastError = error;
      if (error instanceof SsrfError && !["network_failure", "timeout"].includes(error.code)) throw error;
    }
  }

  throw lastError ?? new SsrfError("network_failure", "RDAP request failed");
}
