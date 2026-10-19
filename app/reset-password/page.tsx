import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Activity } from "lucide-react";
import { PasswordInput } from "@/app/_components/password-input";
import { updatePassword } from "@/app/reset-password/actions";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Choose a new password" };

export default function ResetPasswordPage(props: {
  searchParams: Promise<{ error?: string }>;
}) {
  return (
    <Suspense fallback={<ResetPasswordLoading />}>
      <ResetPasswordContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function ResetPasswordContent({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await connection();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/forgot-password?error=link");
  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-5 py-12">
      <div className="w-full max-w-[420px]">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-600 text-white shadow-lg shadow-red-600/20">
            <Activity size={23} strokeWidth={2.5} />
          </span>
          <h1 className="mt-5 text-xl font-bold tracking-tight text-slate-950">Choose a new password</h1>
          <p className="mt-1.5 text-sm text-slate-500">Use at least 12 characters for your new password.</p>
        </div>
        <form action={updatePassword} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          {error && (
            <p role="alert" className="mb-5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-xs leading-5 text-red-700">
              {error === "invalid"
                ? "Use at least 12 characters and make sure both passwords match."
                : "Your password could not be updated. Please try again."}
            </p>
          )}
          <label htmlFor="password" className="mb-1.5 block text-xs font-semibold text-slate-700">New password</label>
          <PasswordInput autoComplete="new-password" minLength={12} />
          <p className="mt-1.5 text-[11px] text-slate-400">Use at least 12 characters.</p>
          <label htmlFor="confirmation" className="mb-1.5 mt-4 block text-xs font-semibold text-slate-700">Confirm new password</label>
          <PasswordInput id="confirmation" name="confirmation" autoComplete="new-password" minLength={12} />
          <button type="submit" className="mt-6 h-11 w-full rounded-lg bg-red-600 px-4 text-sm font-semibold text-white transition hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2">
            Update password
          </button>
          <p className="mt-5 text-center text-xs text-slate-500">
            <Link href="/login" className="font-semibold text-red-700 hover:underline">Back to sign in</Link>
          </p>
        </form>
      </div>
    </main>
  );
}

function ResetPasswordLoading() {
  return <main className="flex min-h-screen items-center justify-center bg-white px-5"><div className="h-96 w-full max-w-[420px] animate-pulse rounded-2xl bg-white" /></main>;
}
