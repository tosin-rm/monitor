"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

export function PasswordInput({
  id = "password",
  name = "password",
  autoComplete = "current-password",
  required = true,
  minLength,
}: {
  id?: string;
  name?: string;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        id={id}
        name={name}
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
        className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 pr-11 text-sm text-slate-900 outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-100"
      />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-slate-400 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-500"
      >
        {visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
      </button>
    </div>
  );
}
