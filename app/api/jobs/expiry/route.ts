import { NextResponse, type NextRequest } from "next/server";
import { isJobSecretValid } from "@/lib/env";
import { runExpiryEvaluation } from "@/lib/jobs/run-expiry";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!isJobSecretValid(token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runExpiryEvaluation(
      createAdminClient(),
      process.env.WORKER_ID?.trim() || "dashboard-cron",
    );
    return NextResponse.json(result);
  } catch (error) {
    console.error("Expiry job endpoint failed", {
      code: error && typeof error === "object" && "code" in error ? error.code : "job_error",
    });
    return NextResponse.json({ error: "Expiry evaluation failed" }, { status: 500 });
  }
}
