import { domainToASCII } from "node:url";
import { isIP } from "node:net";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

export function normalizeHttpUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("URL is required");
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    throw new Error("Enter a valid HTTP or HTTPS URL");
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error("Only HTTP and HTTPS URLs are allowed");
  }
  if (parsed.username || parsed.password) {
    throw new Error("URLs must not include credentials");
  }
  parsed.hash = "";
  return parsed.toString();
}

export function normalizeDomain(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Domain is required");
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let inputUrl: URL;
  try {
    inputUrl = new URL(withProtocol);
  } catch {
    throw new Error("Enter a valid domain name");
  }
  if (!ALLOWED_PROTOCOLS.has(inputUrl.protocol) || inputUrl.username || inputUrl.password) {
    throw new Error("Enter a valid HTTP or HTTPS domain");
  }
  const hostname = domainToASCII(inputUrl.hostname.toLowerCase().replace(/\.$/, ""));
  if (!hostname || hostname.length > 253 || isIP(hostname)) {
    throw new Error("Enter a valid domain name");
  }
  const labels = hostname.split(".");
  const validLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  if (
    labels.length < 2
    || labels.some((label) => label.length > 63 || !validLabel.test(label))
    || !/[a-z]/.test(labels.at(-1) ?? "")
  ) {
    throw new Error("Enter a fully qualified domain name");
  }
  return hostname;
}

export function dashboardUrl(path: string): string {
  const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
  return new URL(path, base).toString();
}
