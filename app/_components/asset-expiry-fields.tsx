"use client";

import { useState, useTransition } from "react";
import { lookupAssetExpiry } from "@/app/websites/actions";
import { assetDateSourceLabel } from "@/lib/assets/date-source";

type ExpirySource = "manual" | "rdap" | "certificate_inspection" | "unknown";

function expirySource(source: string | null | undefined): ExpirySource {
  if (source === "rdap" || source === "certificate_inspection" || source === "manual") return source;
  return "unknown";
}

export function AssetExpiryFields({ idPrefix, assetType: initialType, hostname: initialHostname, expiryDate: initialDate, dateSource, lastVerified }: {
  idPrefix: string;
  assetType: string;
  hostname: string | null;
  expiryDate: string | null;
  dateSource?: string | null;
  lastVerified?: boolean;
}) {
  const [assetType, setAssetType] = useState(initialType);
  const [hostname, setHostname] = useState(initialHostname ?? "");
  const [expiryDate, setExpiryDate] = useState(initialDate ?? "");
  const [source, setSource] = useState(expirySource(dateSource));
  const [verified, setVerified] = useState(dateSource === "manual" && Boolean(lastVerified));
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const canLookup = assetType === "domain" || assetType === "ssl_certificate";

  function lookup() {
    setMessage("");
    startTransition(async () => {
      const result = await lookupAssetExpiry(assetType, hostname);
      setMessage(result.message);
      if (result.success && result.expiryDate && result.source) {
        setExpiryDate(result.expiryDate);
        setSource(result.source);
        setVerified(false);
      }
    });
  }

  return <>
    <div>
      <label htmlFor={`${idPrefix}-type`} className="mb-1.5 block text-[11px] font-semibold text-slate-700">Service type</label>
      <select id={`${idPrefix}-type`} name="assetType" value={assetType} onChange={(event) => {
        setAssetType(event.target.value);
        setSource("manual");
        setVerified(false);
      }} className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs">
        {[["domain", "Domain"], ["hosting", "Hosting"], ["ssl_certificate", "SSL certificate"], ["other", "Other"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </div>
    <div>
      <label htmlFor={`${idPrefix}-hostname`} className="mb-1.5 block text-[11px] font-semibold text-slate-700">Domain or hostname</label>
      <input id={`${idPrefix}-hostname`} name="hostname" value={hostname} onChange={(event) => {
        setHostname(event.target.value);
        setSource("manual");
        setVerified(false);
      }} maxLength={253} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-xs" placeholder="example.com" />
    </div>
    <div>
      <label htmlFor={`${idPrefix}-expiry`} className="mb-1.5 block text-[11px] font-semibold text-slate-700">Expiry date (domain, hosting, SSL)</label>
      <input id={`${idPrefix}-expiry`} name="expiryDate" type="date" value={expiryDate} onChange={(event) => {
        setExpiryDate(event.target.value);
        setSource("manual");
        setVerified(false);
      }} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-xs" />
      <input type="hidden" name="expirySource" value={source} />
      {canLookup && <button type="button" onClick={lookup} disabled={isPending || !hostname.trim()} className="mt-2 rounded-md border border-slate-200 px-2.5 py-1.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
        {isPending ? "Looking up..." : assetType === "domain" ? "Look up with RDAP" : "Check live certificate"}
      </button>}
      <p className="mt-1 text-[10px] text-slate-500">Date source: {assetDateSourceLabel(source)}. You can edit the date before saving.</p>
      {message && <p role="status" className="mt-1 text-[10px] leading-4 text-slate-600">{message}</p>}
    </div>
    <label className="flex items-center gap-2 text-[10px] text-slate-600 sm:col-span-2">
      <input type="checkbox" name="verified" checked={verified} onChange={(event) => setVerified(event.target.checked)} className="rounded border-slate-300 text-red-600 focus:ring-red-500" />
      I have verified the manually entered expiry date with the provider.
    </label>
  </>;
}
