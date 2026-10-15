import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Activity, ArrowRight } from "lucide-react";
import { signUp } from "@/app/auth/actions";
import { getRequestAuthContext } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Create an account" };

export default function SignupPage(props: {
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  return (
    <Suspense fallback={<SignupLoading />}>
      <SignupContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function SignupContent({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  const context = await getRequestAuthContext();
  if (context) redirect(context.organizationId ? "/" : "/setup");
  const { error, sent } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f7fa] px-5 py-12">
      <div className="w-full max-w-[420px]">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-600/20">
            <Activity size={23} strokeWidth={2.5} />
          </span>
          <h1 className="mt-5 text-xl font-bold tracking-tight text-slate-950">Create your Monitor account</h1>
          <p className="mt-1.5 text-sm text-slate-500">New accounts join the existing workspace as Members.</p>
        </div>
        <form action={signUp} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          {sent ? (
            <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm leading-6 text-emerald-800">
              Check your email for a confirmation link. After confirming, you’ll be added to the workspace as a Member.
            </p>
          ) : (
            <>
              {error && (
                <p role="alert" className="mb-5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-xs leading-5 text-red-700">
                  {error === "invalid"
                    ? "Enter a valid email address and a password with at least 12 characters."
                    : "We couldn’t create your account. Check the details and try again, or contact the workspace administrator."}
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
              <label htmlFor="password" className="mb-1.5 block text-xs font-semibold text-slate-700">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                required
                className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
              <p className="mt-1.5 text-[11px] text-slate-400">Use at least 12 characters.</p>
              <button type="submit" className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-semibold text-white transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">
                Create account <ArrowRight size={16} />
              </button>
              <p className="mt-5 text-center text-[11px] leading-5 text-slate-400">
                Signup is open to team members. Every account receives Member permissions.
              </p>
            </>
          )}
          <p className="mt-5 text-center text-xs text-slate-500">
            Already have an account? <Link href="/login" className="font-semibold text-blue-700 hover:underline">Sign in</Link>
          </p>
        </form>
      </div>
    </main>
  );
}

function SignupLoading() {
  return <main className="flex min-h-screen items-center justify-center bg-[#f5f7fa] px-5"><div className="h-96 w-full max-w-[420px] animate-pulse rounded-2xl bg-white" /></main>;
}
