function read(name: string): string | undefined {
  const value = process.env[name];
  if (!value || value.trim() === "") return undefined;
  return value;
}

export function publicSupabaseUrl(): string {
  const url = read("NEXT_PUBLIC_SUPABASE_URL");
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured");
  return url;
}

export function publicSupabaseKey(): string {
  const key =
    read("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") ??
    read("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY is required",
    );
  }
  return key;
}

export function supabaseSecretKey(): string {
  const key = read("SUPABASE_SECRET_KEY") ?? read("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) {
    throw new Error("SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is required");
  }
  return key;
}

export function appBaseUrl(): string {
  return read("APP_BASE_URL") ?? "http://localhost:3000";
}

export function bootstrapOwnerEmail(): string | undefined {
  return read("BOOTSTRAP_OWNER_EMAIL")?.toLowerCase();
}

export function monitoringJobSecret(): string {
  const secret = read("MONITORING_JOB_SECRET");
  if (!secret) throw new Error("MONITORING_JOB_SECRET is not configured");
  return secret;
}

export function defaultTimeZone(): string {
  return read("DEFAULT_TIMEZONE") ?? "Europe/London";
}

export function isJobSecretValid(header: string | null): boolean {
  const expected = read("MONITORING_JOB_SECRET");
  if (!expected || !header) return false;
  if (header.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= expected.charCodeAt(i) ^ header.charCodeAt(i);
  }
  return mismatch === 0;
}
