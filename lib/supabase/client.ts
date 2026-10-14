"use client";

import { createBrowserClient } from "@supabase/ssr";
import { publicSupabaseKey, publicSupabaseUrl } from "@/lib/env";

export function createClient() {
  return createBrowserClient(publicSupabaseUrl(), publicSupabaseKey());
}
