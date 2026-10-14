import { describe, expect, it } from "vitest";
import { normalizeDomain } from "@/lib/urls";

describe("domain normalization", () => {
  it("normalizes case, trailing dots, URL paths, and internationalized names", () => {
    expect(normalizeDomain(" HTTPS://Example.COM./manage ")).toBe("example.com");
    expect(normalizeDomain("bücher.example")).toBe("xn--bcher-kva.example");
  });

  it("rejects invalid protocols, credentials, IP addresses, and malformed labels", () => {
    expect(() => normalizeDomain("ftp://example.com")).toThrow();
    expect(() => normalizeDomain("https://user@example.com")).toThrow();
    expect(() => normalizeDomain("127.0.0.1")).toThrow();
    expect(() => normalizeDomain("bad_label.example")).toThrow();
  });
});
