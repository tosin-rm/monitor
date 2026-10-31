import { describe, expect, it } from "vitest";
import { effectiveWebsiteStatus, lifecycleLabel, parseLifecycleFilter } from "@/lib/lifecycle/status";

describe("client and website lifecycle", () => {
  it("uses the client status as the effective website status unless the website has its own status", () => {
    expect(effectiveWebsiteStatus("active", "on_hold")).toBe("on_hold");
    expect(effectiveWebsiteStatus("transferred", "active")).toBe("transferred");
    expect(effectiveWebsiteStatus("archived", "on_hold")).toBe("archived");
  });

  it("labels statuses and defaults invalid filters to active", () => {
    expect(lifecycleLabel("on_hold")).toBe("On hold");
    expect(parseLifecycleFilter("transferred")).toBe("transferred");
    expect(parseLifecycleFilter("all")).toBe("all");
    expect(parseLifecycleFilter("unexpected")).toBe("active");
  });
});
