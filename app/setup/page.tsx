import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Activity, ShieldCheck } from "lucide-react";
import { bootstrapOrganization } from "@/app/setup/actions";
import { getAuthContext } from "@/lib/auth/session";
import { bootstrapOwnerEmail } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Initial workspace setup" };

export default function SetupPage(props: {
  searchParams: Promise<{ error?: string }>;
}) {
  return (
    <Suspense fallback={<SetupLoading />}>
      <SetupContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function SetupContent({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  if (context.organizationId) redirect("/");

  const configuredOwner = bootstrapOwnerEmail();
  const isBootstrapOwner = Boolean(configuredOwner && context.email.toLowerCase() === configuredOwner);
  let bootstrapAvailable = false;
  if (isBootstrapOwner) {
    const admin = createAdminClient();
    const { count, error } = await admin.from("organizations").select("id", { count: "exact", head: true });
    if (error) {
      console.error("Could not check initial setup status", { code: error.code });
      throw new Error("Workspace setup status could not be checked.");
    }
    bootstrapAvailable = count === 0;
  }

  const { error } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f7fa] px-5 py-12">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-7 shadow-sm sm:p-9">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600 text-white"><Activity size={21} /></div>
        <h1 className="mt-5 text-xl font-bold tracking-tight text-slate-950">Workspace access</h1>
        {bootstrapAvailable ? (
          <>
            <p className="mt-2 text-sm leading-6 text-slate-500">Create the first organization for this private Monitor instance. This one-time setup is restricted to the configured bootstrap owner.</p>
            {error && (
              <p role="alert" className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs leading-5 text-amber-800">
                {error === "invalid" ? "Enter a valid organization name and IANA timezone." : "Initial setup could not be completed. Confirm server configuration and try again."}
              </p>
            )}
            <form action={bootstrapOrganization} className="mt-6 space-y-4">
              <div>
                <label htmlFor="organizationName" className="mb-1.5 block text-xs font-semibold text-slate-700">Organization name</label>
                <input id="organizationName" name="organizationName" required maxLength={120} className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" placeholder="Studio name" />
              </div>
              <div>
                <label htmlFor="timeZone" className="mb-1.5 block text-xs font-semibold text-slate-700">Organization timezone</label>
                <input id="timeZone" name="timeZone" required maxLength={100} defaultValue="Europe/London" className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
                <p className="mt-1.5 text-[11px] text-slate-400">Use an IANA name such as Europe/London or America/New_York.</p>
              </div>
              <button type="submit" className="h-11 w-full rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700">Create workspace</button>
            </form>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Your account is not yet attached to a workspace. Ask an owner or administrator to invite this email address.
            </p>
            <div className="mt-6 flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <ShieldCheck size={17} className="mt-0.5 shrink-0 text-slate-500" />
              <p className="text-xs leading-5 text-slate-600">Workspace membership is managed by authorized team administrators. No public account registration or self-service access is available.</p>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function SetupLoading() {
  return <main className="flex min-h-screen items-center justify-center bg-[#f5f7fa] px-5"><div className="h-96 w-full max-w-lg animate-pulse rounded-2xl bg-white" /></main>;
}
