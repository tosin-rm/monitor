import { NextResponse, type NextRequest } from "next/server";
import { isJobSecretValid } from "@/lib/env";
import { dispatchNotifications } from "@/lib/jobs/dispatch-notifications";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!isJobSecretValid(token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await dispatchNotifications(
      createAdminClient(),
      process.env.WORKER_ID?.trim() || "dashboard-cron",
    );
    return NextResponse.json(result);
  } catch (error) {
    console.error("Notification job endpoint failed", {
      code: error && typeof error === "object" && "code" in error ? error.code : "job_error",
    });
    return NextResponse.json({ error: "Notification dispatch failed" }, { status: 500 });
  }
}
