import {
  backoffSeconds,
  MAX_NOTIFICATION_ATTEMPTS,
  type SendResult,
} from "@/lib/notifications/types";

export function retryFailureUpdate(options: {
  result: SendResult;
  attempts: number;
  maxAttempts: number;
  now: Date;
}): {
  status: "failed";
  retryable: boolean;
  next_attempt_at: string;
} {
  const retryable =
    !options.result.ok
    && options.result.retryable
    && options.attempts < Math.min(options.maxAttempts, MAX_NOTIFICATION_ATTEMPTS);
  return {
    status: "failed",
    retryable,
    next_attempt_at: retryable
      ? new Date(options.now.getTime() + backoffSeconds(options.attempts) * 1000).toISOString()
      : options.now.toISOString(),
  };
}
