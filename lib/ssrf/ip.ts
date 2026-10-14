import { isIP } from "node:net";

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4 || isIP(ip) !== 4) return null;
  const nums = parts.map((part) => Number(part));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((((nums[0] << 24) >>> 0) + (nums[1] << 16) + (nums[2] << 8) + nums[3]) >>> 0);
}

function inCidr(ip: string, cidr: string): boolean {
  const [range, bitsRaw] = cidr.split("/");
  if (!range || bitsRaw == null) return false;
  const bits = Number(bitsRaw);
  const ipInt = ipv4ToInt(ip);
  const rangeInt = ipv4ToInt(range);
  if (ipInt == null || rangeInt == null || !Number.isInteger(bits)) return false;
  const mask = bits === 0 ? 0 : (~(2 ** (32 - bits) - 1) >>> 0);
  return (ipInt & mask) === (rangeInt & mask);
}

const IPV4_BLOCKED = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
  "255.255.255.255/32",
];

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.google.com",
  "kubernetes",
  "kubernetes.default",
  "kubernetes.default.svc",
]);

export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return true;
  }
  if (host === "metadata" || host.endsWith(".metadata.google.internal")) return true;
  return false;
}

export function isBlockedIpv4(ip: string): boolean {
  return IPV4_BLOCKED.some((cidr) => inCidr(ip, cidr));
}

function expandIpv6(ip: string): number[] | null {
  if (isIP(ip) !== 6) return null;
  let normalized = ip.toLowerCase();
  if (normalized.includes(".")) {
    const dotted = normalized.slice(normalized.lastIndexOf(":") + 1);
    const value = ipv4ToInt(dotted);
    if (value == null) return null;
    normalized = `${normalized.slice(0, normalized.lastIndexOf(":"))}:${((value >>> 16) & 0xffff).toString(16)}:${(value & 0xffff).toString(16)}`;
  }
  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const parseGroup = (part: string) => part.split(":").filter(Boolean).map((group) => Number.parseInt(group, 16));
  const head = parseGroup(halves[0] ?? "");
  const tail = halves.length === 2 ? parseGroup(halves[1] ?? "") : [];
  if ([...head, ...tail].some((n) => !Number.isInteger(n) || n < 0 || n > 0xffff)) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const groups = [...head, ...Array(missing).fill(0), ...tail];
  if (groups.length !== 8) return null;
  const bytes: number[] = [];
  for (const group of groups) {
    bytes.push((group >> 8) & 0xff, group & 0xff);
  }
  return bytes;
}

export function isBlockedIpv6(ip: string): boolean {
  const bytes = expandIpv6(ip.toLowerCase());
  if (!bytes) return true;
  const isUnspecified = bytes.every((b) => b === 0);
  if (isUnspecified) return true;
  const isLoopback = bytes.slice(0, 15).every((b) => b === 0) && bytes[15] === 1;
  if (isLoopback) return true;
  if ((bytes[0]! & 0xe0) !== 0x20) return true; // only global unicast (2000::/3) is allowed
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if ((bytes[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique local
  if (bytes[0] === 0xff) return true; // multicast
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3]! <= 0x01) {
    return true; // 2001:0000::/23 IETF special-purpose assignments
  }
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return true; // 6to4 transition space
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) {
    return true; // documentation
  }
  if (bytes[0] === 0x3f && bytes[1] === 0xff && (bytes[2]! & 0xf0) === 0x00) return true; // documentation
  const ipv4Mapped =
    bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  if (ipv4Mapped) {
    const v4 = `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
    return isBlockedIpv4(v4);
  }
  return false;
}

export function isBlockedIp(ip: string): boolean {
  const normalized = ip.replace(/^\[|\]$/g, "");
  if (normalized.includes(":")) return isBlockedIpv6(normalized);
  return isBlockedIpv4(normalized);
}

export const ALLOWED_PORTS = new Set([80, 443]);
