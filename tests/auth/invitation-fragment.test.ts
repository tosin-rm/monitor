import { describe, expect, it } from "vitest";
import { invitationTokensFromHash } from "@/lib/auth/invitation-fragment";

describe("invitation token fragments", () => {
  it("extracts tokens from Supabase's default invite redirect", () => {
    expect(invitationTokensFromHash(
      "#access_token=access&refresh_token=refresh&type=invite",
    )).toEqual({ access_token: "access", refresh_token: "refresh" });
  });

  it("ignores fragments for other auth flows or incomplete sessions", () => {
    expect(invitationTokensFromHash("#access_token=access&type=invite")).toBeNull();
    expect(invitationTokensFromHash(
      "#access_token=access&refresh_token=refresh&type=recovery",
    )).toBeNull();
    expect(invitationTokensFromHash("")).toBeNull();
  });
});
