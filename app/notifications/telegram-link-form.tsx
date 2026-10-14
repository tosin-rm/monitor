"use client";

import { useActionState } from "react";
import { createTelegramLinkChallenge } from "@/app/notifications/actions";

export function TelegramLinkForm() {
  const [state, action, pending] = useActionState(createTelegramLinkChallenge, {
    code: null,
    error: null,
  });

  return <div>
    <form action={action}>
      <button type="submit" disabled={pending} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
        {pending ? "Creating code…" : "Generate secure link code"}
      </button>
    </form>
    {state.error && <p role="alert" className="mt-2 text-xs text-red-700">{state.error}</p>}
    {state.code && <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
      <p className="text-[11px] font-semibold text-blue-900">Open your team bot and send this command within 10 minutes:</p>
      <code className="mt-2 block break-all rounded bg-white px-2 py-2 text-xs text-slate-800">/start {state.code}</code>
      <p className="mt-2 text-[10px] leading-4 text-blue-800">The code is one-use. Do not share it outside the intended private chat or approved team group.</p>
    </div>}
  </div>;
}
