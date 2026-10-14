import { describe, expect, it } from "vitest";
import { can, hasMinRole, parseRole } from "@/lib/auth/roles";

describe("organization role permissions", () => {
  it("grants operational and administration permissions at the intended role", () => {
    expect(can("member", "confirm_renewals")).toBe(true);
    expect(can("member", "manage_assets")).toBe(false);
    expect(can("admin", "manage_members")).toBe(true);
    expect(can("admin", "assign_owner")).toBe(false);
    expect(can("owner", "assign_owner")).toBe(true);
  });

  it("parses only known roles and compares role hierarchy", () => {
    expect(parseRole("admin")).toBe("admin");
    expect(parseRole("superuser")).toBeNull();
    expect(hasMinRole("admin", "member")).toBe(true);
    expect(hasMinRole("member", "admin")).toBe(false);
  });
});
