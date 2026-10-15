import { describe, expect, it } from "vitest";
import { canUseDevPreview } from "@/lib/auth/dev-preview";

describe("local developer preview access", () => {
  it("requires both development mode and explicit opt-in", () => {
    expect(canUseDevPreview("development", "true")).toBe(true);
    expect(canUseDevPreview("development", undefined)).toBe(false);
    expect(canUseDevPreview("production", "true")).toBe(false);
    expect(canUseDevPreview("test", "true")).toBe(false);
    expect(canUseDevPreview(undefined, "true")).toBe(false);
  });
});
