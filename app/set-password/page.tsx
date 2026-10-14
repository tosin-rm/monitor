import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { KeyRound } from "lucide-react";
import { setPassword } from "@/app/set-password/actions";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Set your password" };

export default function SetPasswordPage(props: {
  searchParams: Promise<{ error?: string }>;
}) {
  return (
    <Suspense fallback={<PasswordLoading />}>
      <SetPasswordContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function SetPasswordContent({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f7fa] px-5 py-12">
      <form action={setPassword} className="w-full max-w-[420px] rounded-2xl border border-slate-200 bg-white p-7 shadow-sm sm:p-8">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><KeyRound size={20} /></span>
        <h1 className="mt-5 text-xl font-bold tracking-tight text-slate-950">Set your password</h1>
        <p className="mt-1.5 text-sm leading-6 text-slate-500">Create a password for your invited team account.</p>
        {error && (
          <p role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-xs leading-5 text-red-700">
            {error === "invalid" ? "Use at least 12 characters and make sure both passwords match." : "Your password could not be updated. Please try again."}
          </p>
        )}
        <label htmlFor="password" className="mb-1.5 mt-5 block text-xs font-semibold text-slate-700">New password</label>
        <input id="password" name="password" type="password" autoComplete="new-password" minLength={12} required className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
        <label htmlFor="confirmation" className="mb-1.5 mt-4 block text-xs font-semibold text-slate-700">Confirm password</label>
        <input id="confirmation" name="confirmation" type="password" autoComplete="new-password" minLength={12} required className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
        <button type="submit" className="mt-6 h-11 w-full rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700">Save password</button>
      </form>
    </main>
  );
}

function PasswordLoading() {
  return <main className="flex min-h-screen items-center justify-center bg-[#f5f7fa] px-5"><div className="h-80 w-full max-w-[420px] animate-pulse rounded-2xl bg-white" /></main>;
}
