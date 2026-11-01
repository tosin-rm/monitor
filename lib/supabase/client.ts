"use client";

import { createBrowserClient } from "@supabase/ssr";
import { publicSupabaseKey, publicSupabaseUrl } from "@/lib/env";

export function createClient(options?: { detectSessionInUrl?: boolean }) {
  return createBrowserClient(
    publicSupabaseUrl(),
    publicSupabaseKey(),
    options
      ? {
          auth: { detectSessionInUrl: options.detectSessionInUrl },
          isSingleton: false,
        }
      : undefined,
  );
}
