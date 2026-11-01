"use client";

import { useEffect } from "react";
import { classifyAuthCallbackError } from "@/lib/auth/callback-error";
import { invitationTokensFromHash } from "@/lib/auth/invitation-fragment";
import { createClient } from "@/lib/supabase/client";

export function InvitationFragmentHandler() {
  useEffect(() => {
    const tokens = invitationTokensFromHash(window.location.hash);
    if (!tokens) return;

    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}`,
    );

    let active = true;
    const establishInviteSession = async () => {
      try {
        const supabase = createClient({ detectSessionInUrl: false });
        const { error } = await supabase.auth.setSession(tokens);
        if (!active) return;
        if (error) {
          console.error("Invite fragment session setup failed", { code: error.code ?? "auth_error" });
          const failure = classifyAuthCallbackError(error.code ?? error.message);
          window.location.replace(`/login?error=invite-${failure}`);
          return;
        }
        window.location.replace("/set-password");
      } catch (error) {
        if (!active) return;
        console.error("Invite fragment session setup failed", {
          code: error && typeof error === "object" && "code" in error ? error.code : "auth_error",
        });
        window.location.replace("/login?error=invite-invalid");
      }
    };

    void establishInviteSession();
    return () => {
      active = false;
    };
  }, []);

  return null;
}
