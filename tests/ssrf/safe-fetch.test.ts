import { describe, expect, it, vi } from "vitest";
import { safeHttpCheck } from "@/lib/ssrf/safe-fetch";
import { SsrfError, validateDestination } from "@/lib/ssrf/validate";
import { isBlockedIp } from "@/lib/ssrf/ip";

const publicLookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }]);

describe("safe HTTP checks", () => {
  it("pins the request destination and preserves the original HTTPS hostname", async () => {
    const transport = vi.fn(async () => ({ status: 200, location: null, bodyPreview: "" }));
    const result = await safeHttpCheck({
      url: "https://status.example/path",
      timeoutMs: 2_000,
      followRedirects: true,
      lookup: publicLookup,
      transport,
    });
    expect(result.status).toBe(200);
    expect(transport).toHaveBeenCalledWith(expect.objectContaining({
      safe: expect.objectContaining({
        hostname: "status.example",
        url: expect.objectContaining({ protocol: "https:" }),
      }),
      address: { address: "93.184.216.34", family: 4 },
    }));
  });

  it("revalidates each redirect and blocks redirects into private networks", async () => {
    const transport = vi.fn(async () => ({
      status: 302,
      location: "http://127.0.0.1/admin",
      bodyPreview: "",
    }));
    await expect(safeHttpCheck({
      url: "https://status.example",
      timeoutMs: 2_000,
      followRedirects: true,
      lookup: publicLookup,
      transport,
    })).rejects.toMatchObject({ code: "blocked_host" });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("revalidates DNS for the redirected hostname to prevent rebinding", async () => {
    const lookup = vi.fn()
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 as const }])
      .mockResolvedValueOnce([{ address: "10.0.0.5", family: 4 as const }]);
    const transport = vi.fn(async () => ({
      status: 302,
      location: "https://status.example/next",
      bodyPreview: "",
    }));
    await expect(safeHttpCheck({
      url: "https://status.example/start",
      timeoutMs: 2_000,
      followRedirects: true,
      lookup,
      transport,
    })).rejects.toMatchObject({ code: "blocked_ip" });
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("bounds DNS resolution by the endpoint timeout", async () => {
    await expect(validateDestination(
      "https://status.example",
      () => new Promise(() => {}),
      1,
    )).rejects.toMatchObject({ code: "timeout" });
  });

  it("rejects DNS answers containing any blocked address", async () => {
    await expect(validateDestination("https://status.example", async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ])).rejects.toMatchObject({ code: "blocked_ip" });
  });

  it("blocks reserved IPv6 destinations, including IPv4-mapped private addresses", () => {
    expect(isBlockedIp("::ffff:10.0.0.1")).toBe(true);
    expect(isBlockedIp("2001:db8::1")).toBe(true);
    expect(isBlockedIp("2001:4860:4860::8888")).toBe(false);
  });

  it("rejects credentials, unsupported protocols, and nonstandard ports", async () => {
    await expect(validateDestination("ftp://status.example", publicLookup)).rejects.toBeInstanceOf(SsrfError);
    await expect(validateDestination("https://user:pass@status.example", publicLookup)).rejects.toMatchObject({ code: "credentials_forbidden" });
    await expect(validateDestination("https://status.example:8443", publicLookup)).rejects.toMatchObject({ code: "invalid_port" });
  });
});
