"use client";

import { X } from "lucide-react";
import { useState, type ReactNode } from "react";

export function DismissibleNotice({
  children,
  className,
  role = "status",
}: {
  children: ReactNode;
  className: string;
  role?: "status" | "alert";
}) {
  const [visible, setVisible] = useState(true);
  if (!visible) return null;

  return (
    <div role={role} className={`flex items-start justify-between gap-3 ${className}`}>
      <div>{children}</div>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={() => setVisible(false)}
        className="shrink-0 rounded p-0.5 opacity-70 hover:bg-black/5 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-current"
      >
        <X size={14} />
      </button>
    </div>
  );
}
