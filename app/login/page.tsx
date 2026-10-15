import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Activity, ArrowRight, LockKeyhole } from "lucide-react";
import { signIn } from "@/app/auth/actions";
import { getRequestAuthContext } from "@/lib/auth/session";
import { canUseDevPreview } from "@/lib/auth/dev-preview";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage(props: {
  searchParams: Promise<{ error?: string }>;
}) {
  return (
    <Suspense fallback={<LoginLoading />}>
      <LoginContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function LoginContent({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const context = await getRequestAuthContext();
  if (context) redirect(context.organizationId ? "/" : "/setup");
  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f7fa] px-5 py-12">
      <div className="w-full max-w-[420px]">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-600/20">
            <Activity size={23} strokeWidth={2.5} />
          </span>
          <h1 className="mt-5 text-xl font-bold tracking-tight text-slate-950">Sign in to Monitor</h1>
          <p className="mt-1.5 text-sm text-slate-500">Private access for your client operations team.</p>
        </div>
        <form action={signIn} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          {error && (
            <p role="alert" className="mb-5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-xs leading-5 text-red-700">
              {error === "credentials"
                ? "Sign-in failed. Check your email and password, or contact your workspace administrator."
                : error === "invite"
                  ? "The invitation link is invalid, expired, or already used. Ask the workspace administrator to send a new invitation."
                  : error === "signup"
                    ? "The confirmation link is invalid or expired. Please sign up again."
                  : "Your sign-in link could not be completed. Ask the workspace administrator for help."}
            </p>
          )}
          <label htmlFor="email" className="mb-1.5 block text-xs font-semibold text-slate-700">Work email</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            className="mb-5 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            placeholder="you@company.com"
          />
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="password" className="text-xs font-semibold text-slate-700">Password</label>
            <LockKeyhole size={14} className="text-slate-400" aria-hidden="true" />
          </div>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
          <button type="submit" className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-semibold text-white transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">
            Sign in <ArrowRight size={16} />
          </button>
          <p className="mt-5 text-center text-[11px] leading-5 text-slate-400">
            Need an account? <Link href="/signup" className="font-semibold text-blue-700 hover:underline">Sign up</Link>
          </p>
          {canUseDevPreview(process.env.NODE_ENV, process.env.DEV_PREVIEW_ENABLED) && (
            <p className="mt-3 text-center text-[11px]">
              <Link href="/dev-preview" className="font-semibold text-blue-700 hover:underline">Open local design preview</Link>
              <span className="mt-1 block text-slate-400">Sample data only; no account or database access.</span>
            </p>
          )}
        </form>
      </div>
    </main>
  );
}

function LoginLoading() {
  return <main className="flex min-h-screen items-center justify-center bg-[#f5f7fa] px-5"><div className="h-96 w-full max-w-[420px] animate-pulse rounded-2xl bg-white" /></main>;
}
