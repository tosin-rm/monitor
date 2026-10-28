"use client";

import { Printer } from "lucide-react";

export function PrintReportButton() {
  return <button type="button" onClick={() => window.print()} className="no-print inline-flex h-10 items-center gap-2 rounded-lg bg-red-600 px-4 text-xs font-semibold text-white hover:bg-red-700"><Printer size={14} /> Print / Save as PDF</button>;
}
