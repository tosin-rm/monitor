import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Activity, ArrowLeft } from "lucide-react";
import { requestPasswordReset } from "@/app/auth/actions";
import { getRequestAuthContext } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage(props: {
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  return (
    <Suspense fallback={<ForgotPasswordLoading />}>
      <ForgotPasswordContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function ForgotPasswordContent({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  await connection();
  const context = await getRequestAuthContext();
  if (context?.organizationId) redirect("/");
  const { error, sent } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-5 py-12">
      <div className="w-full max-w-[420px]">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-600 text-white shadow-lg shadow-red-600/20">
            <Activity size={23} strokeWidth={2.5} />
          </span>
          <h1 className="mt-5 text-xl font-bold tracking-tight text-slate-950">Forgot your password?</h1>
          <p className="mt-1.5 text-sm text-slate-500">We’ll email you a secure link to choose a new one.</p>
        </div>
        <form action={requestPasswordReset} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          {sent ? (
            <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm leading-6 text-emerald-800">
              If an account exists for that email, a password reset link will arrive shortly. Check your inbox and spam folder.
            </p>
          ) : (
            <>
              {error && (
                <p role="alert" className="mb-5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-xs leading-5 text-red-700">
                  {error === "invalid"
                    ? "Enter a valid email address."
                    : error === "link"
                      ? "That reset link is invalid or expired. Request a new one."
                      : error === "rate-limit"
                        ? "Too many password-reset emails were requested. Wait before trying again."
                        : error === "redirect"
                          ? "The reset link destination is not allowed by Supabase. Ask the workspace administrator to allow this site's /auth/callback URL."
                          : error === "email-provider"
                            ? "Supabase could not send the email. Ask the workspace administrator to check the Auth SMTP provider and email logs."
                            : "We couldn’t send the reset email. Please try again or ask the workspace administrator to check the Supabase Auth logs."}
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
                className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-red-500 focus:ring-2 focus:ring-red-100"
                placeholder="you@company.com"
              />
              <button type="submit" className="mt-6 h-11 w-full rounded-lg bg-red-600 px-4 text-sm font-semibold text-white transition hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2">
                Send reset link
              </button>
            </>
          )}
          <p className="mt-5 text-center text-xs text-slate-500">
            <Link href="/login" className="inline-flex items-center gap-1 font-semibold text-red-700 hover:underline"><ArrowLeft size={13} /> Back to sign in</Link>
          </p>
        </form>
      </div>
    </main>
  );
}

function ForgotPasswordLoading() {
  return <main className="flex min-h-screen items-center justify-center bg-white px-5"><div className="h-80 w-full max-w-[420px] animate-pulse rounded-2xl bg-white" /></main>;
}
