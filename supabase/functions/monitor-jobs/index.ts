const encoder = new TextEncoder();

function secretMatches(expected: string, actual: string | null): boolean {
  if (!actual) return false;
  const left = encoder.encode(expected);
  const right = encoder.encode(actual);
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left[index]! ^ right[index]!;
  }
  return mismatch === 0;
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const functionSecret = Deno.env.get("MONITOR_FUNCTION_SECRET");
  const dashboardBaseUrl = Deno.env.get("DASHBOARD_BASE_URL");
  const jobSecret = Deno.env.get("MONITORING_JOB_SECRET");
  if (!functionSecret || !dashboardBaseUrl || !jobSecret) {
    return Response.json({ error: "Job runner is not configured" }, { status: 503 });
  }
  if (!secretMatches(functionSecret, request.headers.get("x-monitor-function-secret"))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let job: unknown;
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).length > 1024) {
      return Response.json({ error: "Payload too large" }, { status: 413 });
    }
    job = JSON.parse(body);
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!job || typeof job !== "object" || !("job" in job)) {
    return Response.json({ error: "Unknown job" }, { status: 400 });
  }

  const path = job.job === "expiry"
    ? "/api/jobs/expiry"
    : job.job === "notifications"
      ? "/api/jobs/notifications"
      : null;
  if (!path) return Response.json({ error: "Unknown job" }, { status: 400 });

  let target: URL;
  try {
    target = new URL(path, dashboardBaseUrl);
    const base = new URL(dashboardBaseUrl);
    if (target.origin !== base.origin || (base.protocol !== "https:" && base.hostname !== "localhost")) {
      return Response.json({ error: "Dashboard URL must use HTTPS" }, { status: 503 });
    }
  } catch {
    return Response.json({ error: "Dashboard URL is invalid" }, { status: 503 });
  }

  try {
    const response = await fetch(target, {
      method: "POST",
      headers: { authorization: `Bearer ${jobSecret}` },
      signal: AbortSignal.timeout(30_000),
    });
    const result = await response.json().catch(() => ({ error: "Job returned an invalid response" }));
    return Response.json(result, { status: response.ok ? 200 : 502 });
  } catch {
    return Response.json({ error: "Dashboard job endpoint is unavailable" }, { status: 502 });
  }
});
