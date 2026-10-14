import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildExpiryNotifications,
  type ExpiryAsset,
  type OrgNotificationSettings,
} from "@/lib/jobs/evaluate-expiry";
import { acquireJobLease, releaseJobLease } from "@/lib/jobs/lease";

const ASSET_BATCH_SIZE = 500;
const INSERT_BATCH_SIZE = 200;

export async function runExpiryEvaluation(
  supabase: SupabaseClient,
  lockedBy: string,
  now = new Date(),
): Promise<{ processed: number; inserted: number; skipped: boolean }> {
  const leased = await acquireJobLease(supabase, "expiry_eval", lockedBy);
  if (!leased) return { processed: 0, inserted: 0, skipped: true };

  const started = Date.now();
  let runId: string | null = null;
  let failed = false;
  try {
    const { data: run, error: runError } = await supabase
      .from("job_runs")
      .insert({ job_name: "expiry_eval" })
      .select("id")
      .single();
    if (runError) throw runError;
    runId = run.id;

    const assets: ExpiryAsset[] = [];
    for (let offset = 0; ; offset += ASSET_BATCH_SIZE) {
      const { data, error } = await supabase
        .from("assets")
        .select("id, organization_id, website_id, asset_type, service_name, hostname, expiry_date, renewal_status, active")
        .eq("active", true)
        .order("id")
        .range(offset, offset + ASSET_BATCH_SIZE - 1);
      if (error) throw error;
      assets.push(...((data ?? []) as ExpiryAsset[]));
      if (!data || data.length < ASSET_BATCH_SIZE) break;
    }

    const [settingsResult, websitesResult, organizationsResult] = await Promise.all([
      supabase.from("notification_settings").select("organization_id, email_enabled, telegram_enabled, email_recipients, telegram_chat_ids, reminder_intervals"),
      supabase.from("websites").select("id, name"),
      supabase.from("organizations").select("id, timezone"),
    ]);
    if (settingsResult.error) throw settingsResult.error;
    if (websitesResult.error) throw websitesResult.error;
    if (organizationsResult.error) throw organizationsResult.error;

    const settingsByOrg = new Map(
      (settingsResult.data ?? []).map((row) => [
        row.organization_id as string,
        row as OrgNotificationSettings,
      ]),
    );
    const websitesById = new Map(
      (websitesResult.data ?? []).map((row) => [row.id as string, { name: row.name as string }]),
    );
    const timeZoneByOrg = new Map(
      (organizationsResult.data ?? []).map((row) => [row.id as string, row.timezone as string]),
    );

    const queued = buildExpiryNotifications({
      assets,
      settingsByOrg,
      websitesById,
      now,
      timeZoneByOrg,
    });

    let inserted = 0;
    for (let offset = 0; offset < queued.length; offset += INSERT_BATCH_SIZE) {
      const batch = queued.slice(offset, offset + INSERT_BATCH_SIZE);
      const { data, error } = await supabase
        .from("notifications")
        .upsert(
          batch.map((item) => ({
            organization_id: item.organization_id,
            asset_id: item.asset_id,
            event_type: item.event_type,
            channel: item.channel,
            recipient_reference: item.recipient_reference,
            deduplication_key: item.deduplication_key,
            payload: item.payload,
            status: "queued",
            retryable: true,
            scheduled_at: now.toISOString(),
            next_attempt_at: now.toISOString(),
          })),
          {
            onConflict: "organization_id,deduplication_key",
            ignoreDuplicates: true,
          },
        )
        .select("id");
      if (error) throw error;
      inserted += data?.length ?? 0;
    }

    const { error: finishError } = await supabase
      .from("job_runs")
      .update({
        finished_at: new Date().toISOString(),
        success: true,
        processed_count: assets.length,
        error_count: 0,
        duration_ms: Date.now() - started,
        metadata: { queued: queued.length, inserted },
      })
      .eq("id", runId);
    if (finishError) throw finishError;

    return { processed: assets.length, inserted, skipped: false };
  } catch (error) {
    failed = true;
    console.error("Expiry evaluation failed", {
      code: error && typeof error === "object" && "code" in error ? error.code : "job_error",
    });
    if (runId) {
      const { error: updateError } = await supabase
        .from("job_runs")
        .update({
          finished_at: new Date().toISOString(),
          success: false,
          error_count: 1,
          duration_ms: Date.now() - started,
          sanitized_error: "Expiry evaluation failed",
        })
        .eq("id", runId);
      if (updateError) console.error("Could not record expiry job failure", { code: updateError.code });
    }
    throw error;
  } finally {
    try {
      await releaseJobLease(supabase, "expiry_eval", lockedBy);
    } catch (error) {
      console.error("Could not release expiry evaluation lease", {
        code: error && typeof error === "object" && "code" in error ? error.code : "lease_error",
      });
      if (!failed) throw error;
    }
  }
}
