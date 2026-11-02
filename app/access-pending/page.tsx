import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Clock3, ShieldCheck } from "lucide-react";
import { requestWorkspaceAccess } from "@/app/access-pending/actions";
import { signOut } from "@/app/auth/actions";
import { getRequestAuthContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Workspace access pending" };

export default function AccessPendingPage(props: {
  searchParams: Promise<{ error?: string; submitted?: string }>;
}) {
  return (
    <Suspense fallback={<AccessPendingLoading />}>
      <AccessPendingContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function AccessPendingContent({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; submitted?: string }>;
}) {
  const context = await getRequestAuthContext();
  if (!context) redirect("/login");
  if (context.organizationId) redirect("/");

  const admin = createAdminClient();
  const { data: accessRequest, error } = await admin
    .from("workspace_access_requests")
    .select("status")
    .eq("user_id", context.userId)
    .maybeSingle();
  if (error) {
    console.error("Workspace access request status lookup failed", { code: error.code });
    throw new Error("Workspace access status could not be loaded.");
  }

  const { error: requestError, submitted } = await searchParams;
  const canRequest = !accessRequest || accessRequest.status === "rejected";

  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-5 py-12">
      <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-7 shadow-sm sm:p-9">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
          {accessRequest?.status === "pending" ? <Clock3 size={20} /> : <ShieldCheck size={20} />}
        </span>
        <h1 className="mt-5 text-xl font-bold tracking-tight text-slate-950">Workspace access</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Signed in as <span className="font-semibold text-slate-700">{context.email}</span>.
        </p>

        {requestError === "request" && (
          <p role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs leading-5 text-red-700">
            Your access request could not be submitted. Please try again or contact the workspace administrator.
          </p>
        )}
        {submitted && (
          <p role="status" className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs leading-5 text-emerald-800">
            Your request was submitted. You’ll be able to use the workspace after an administrator approves it.
          </p>
        )}

        {accessRequest?.status === "pending" ? (
          <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-900">Your request is waiting for approval.</p>
            <p className="mt-1 text-xs leading-5 text-amber-800">An owner or administrator must approve your account before you can access workspace data.</p>
          </div>
        ) : accessRequest?.status === "rejected" ? (
          <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-800">Your previous request was not approved.</p>
            <p className="mt-1 text-xs leading-5 text-slate-600">If you believe this was a mistake, you may submit a new request.</p>
          </div>
        ) : (
          <p className="mt-6 text-sm leading-6 text-slate-600">
            Your account does not have workspace access yet. Submit a request for an administrator to review.
          </p>
        )}

        {canRequest && (
          <form action={requestWorkspaceAccess} className="mt-6">
            <button type="submit" className="h-11 w-full rounded-lg bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700">
              {accessRequest?.status === "rejected" ? "Request access again" : "Request workspace access"}
            </button>
          </form>
        )}
        <div className="mt-5 text-center text-xs text-slate-500">
          <form action={signOut}>
            <button type="submit" className="font-semibold text-red-700 hover:underline">Sign out</button>
          </form>
        </div>
      </section>
    </main>
  );
}

function AccessPendingLoading() {
  return <main className="flex min-h-screen items-center justify-center bg-white px-5"><div className="h-80 w-full max-w-lg animate-pulse rounded-2xl bg-white" /></main>;
}
