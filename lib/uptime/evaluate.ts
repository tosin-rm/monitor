export type UptimeObservation = {
  success: boolean;
  httpStatus: number | null;
  errorCode?: string | null;
};

export function isExpectedStatus(status: number, expected: number[]): boolean {
  return expected.includes(status);
}

export function nextFailureCount(previous: number, observation: UptimeObservation): number {
  return observation.success ? 0 : previous + 1;
}

export function shouldOpenIncident(options: {
  consecutiveFailures: number;
  threshold: number;
  hasOpenIncident: boolean;
}): boolean {
  return !options.hasOpenIncident && options.consecutiveFailures >= options.threshold;
}

export function shouldResolveIncident(options: {
  hasOpenIncident: boolean;
  observation: UptimeObservation;
}): boolean {
  return options.hasOpenIncident && options.observation.success;
}

export function classifyWorkerVsSiteFailure(errorCode: string | null | undefined): "site" | "monitor" {
  if ([
    "worker_error",
    // A transport failure has no HTTP response, so the monitor cannot tell
    // whether the origin or the checking network prevented the connection.
    // Keep this out of outage streaks to avoid false-positive incidents.
    "network_failure",
    "host_unreachable",
    "network_unreachable",
    "blocked_host",
    "blocked_ip",
    "invalid_url",
    "invalid_protocol",
    "invalid_port",
    "credentials_forbidden",
    "invalid_redirect",
    "too_many_redirects",
  ].includes(errorCode ?? "")) {
    return "monitor";
  }
  // DNS failure means the configured hostname cannot currently resolve, which
  // is a real availability problem for that endpoint rather than a checker
  // policy rejection.
  return "site";
}
