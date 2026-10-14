import type { SupabaseClient } from "@supabase/supabase-js";
import { acquireJobLease, releaseJobLease } from "@/lib/jobs/lease";
import { defaultNotificationChannels } from "@/lib/notifications/registry";
import {
  type NotificationChannel,
  type NotificationChannelName,
  type NotificationPayload,
  type SendResult,
} from "@/lib/notifications/types";
import { retryFailureUpdate } from "@/lib/notifications/retry";

type ClaimedNotification = {
  id: string;
  organization_id: string;
  channel: NotificationChannelName;
  recipient_reference: string;
  payload: NotificationPayload;
  attempts: number;
  max_attempts: number;
};

const LEASE_SECONDS = 240;
const BATCH_LIMIT = 50;

export async function dispatchNotifications(
  supabase: SupabaseClient,
  lockedBy: string,
  channels: Record<NotificationChannelName, NotificationChannel> = defaultNotificationChannels(),
  now = new Date(),
): Promise<{ processed: number; skipped: boolean }> {
  const leased = await acquireJobLease(
    supabase,
    "notification_dispatch",
    lockedBy,
    LEASE_SECONDS,
  );
  if (!leased) return { processed: 0, skipped: true };

  const started = Date.now();
  let runId: string | null = null;
  let failed = false;
  let processed = 0;
  try {
    const { data: run, error: runError } = await supabase
      .from("job_runs")
      .insert({ job_name: "notification_dispatch" })
      .select("id")
      .single();
    if (runError) throw runError;
    runId = run.id;

    const { data: claimed, error: claimError } = await supabase.rpc(
      "claim_notifications",
      { p_limit: BATCH_LIMIT },
    );
    if (claimError) throw claimError;

    for (const row of (claimed ?? []) as ClaimedNotification[]) {
      const channel = channels[row.channel];
      let result: SendResult;
      try {
        if (!channel) {
          result = {
            ok: false,
            retryable: false,
            errorCode: "channel_unavailable",
            sanitizedError: "Notification channel is not available",
          };
        } else {
          result = await channel.send(
            { channel: row.channel, reference: row.recipient_reference },
            row.payload,
          );
        }
      } catch {
        result = {
          ok: false,
          retryable: false,
          errorCode: "outcome_unknown",
          sanitizedError: "Channel outcome is unknown; review provider before retrying",
        };
      }

      const attemptedAt = now.toISOString();
      if (result.ok && result.accepted) {
        const { error } = await supabase
          .from("notifications")
          .update({
            status: "accepted",
            retryable: false,
            sent_at: attemptedAt,
            provider_message_id: result.providerMessageId ?? null,
            sanitized_error: null,
          })
          .eq("id", row.id)
          .eq("status", "sending");
        if (error) throw error;
      } else {
        const sanitizedError = result.ok
          ? "Provider did not accept the message"
          : result.sanitizedError;
        const failureUpdate = retryFailureUpdate({
          result,
          attempts: row.attempts,
          maxAttempts: row.max_attempts,
          now,
        });
        const { error } = await supabase
          .from("notifications")
          .update({
            ...failureUpdate,
            sanitized_error: sanitizedError,
          })
          .eq("id", row.id)
          .eq("status", "sending");
        if (error) throw error;
      }
      processed += 1;
    }

    if (runId) {
      const { error } = await supabase
        .from("job_runs")
        .update({
          finished_at: new Date().toISOString(),
          success: true,
          processed_count: processed,
          error_count: 0,
          duration_ms: Date.now() - started,
        })
        .eq("id", runId);
      if (error) throw error;
    }

    return { processed, skipped: false };
  } catch (error) {
    failed = true;
    console.error("Notification dispatch failed", {
      code: error && typeof error === "object" && "code" in error ? error.code : "job_error",
    });
    if (runId) {
      const { error: updateError } = await supabase
        .from("job_runs")
        .update({
          finished_at: new Date().toISOString(),
          success: false,
          processed_count: processed,
          error_count: 1,
          duration_ms: Date.now() - started,
          sanitized_error: "Notification dispatch failed",
        })
        .eq("id", runId);
      if (updateError) console.error("Could not record dispatch failure", { code: updateError.code });
    }
    throw error;
  } finally {
    try {
      await releaseJobLease(supabase, "notification_dispatch", lockedBy);
    } catch (error) {
      console.error("Could not release notification dispatch lease", {
        code: error && typeof error === "object" && "code" in error ? error.code : "lease_error",
      });
      if (!failed) throw error;
    }
  }
}
