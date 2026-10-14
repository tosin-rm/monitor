import type { SupabaseClient } from "@supabase/supabase-js";

export async function acquireJobLease(
  supabase: SupabaseClient,
  jobName: string,
  lockedBy: string,
  leaseSeconds = 240,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("try_acquire_job_lease", {
    p_job_name: jobName,
    p_locked_by: lockedBy,
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw error;
  return Boolean(data);
}

export async function releaseJobLease(
  supabase: SupabaseClient,
  jobName: string,
  lockedBy: string,
): Promise<void> {
  const { error } = await supabase.rpc("release_job_lease", {
    p_job_name: jobName,
    p_locked_by: lockedBy,
  });
  if (error) throw error;
}
