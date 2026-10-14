import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Activity, ArrowLeft, CheckCircle2, CircleAlert } from "lucide-react";
import { changeIncidentStatus } from "@/app/incidents/actions";
import { can } from "@/lib/auth/roles";
import { getAuthContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Incidents" };

export default function IncidentsPage(props: { searchParams: Promise<{ error?: string; success?: string }> }) {
  return <Suspense fallback={<IncidentsLoading />}><IncidentsContent searchParams={props.searchParams} /></Suspense>;
}

async function IncidentsContent({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  if (!context.organizationId) redirect("/setup");
  const params = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("incidents")
    .select("id, website_id, incident_type, severity, status, started_at, last_observed_at, resolved_at, occurrence_count, summary, websites(name)")
    .eq("organization_id", context.organizationId)
    .order("started_at", { ascending: false })
    .limit(100);
  if (error) {
    console.error("Incident history query failed", { code: error.code });
    throw new Error("Incident history could not be loaded.");
  }
  const rows = data ?? [];

  return <main className="min-h-screen bg-[#f5f7fa] px-5 py-7 sm:px-8 sm:py-9"><div className="mx-auto max-w-6xl">
    <Link href="/" className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-900"><ArrowLeft size={14} /> Overview</Link>
    <div className="mt-6"><h1 className="text-xl font-bold tracking-tight text-slate-950">Incidents</h1><p className="mt-1 text-sm text-slate-500">Operational incident history and response status for this organization.</p></div>
    {params.error && <p role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{params.error === "forbidden" ? "Your role cannot resolve incidents." : params.error === "invalid" ? "The incident update was invalid." : "The incident status could not be updated."}</p>}
    {params.success && <p role="status" className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">Incident status updated.</p>}
    <section className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="text-sm font-bold text-slate-900">Incident timeline</h2><p className="mt-0.5 text-[11px] text-slate-400">Showing the latest 100 incidents. Operational history is retained.</p></div><Activity size={17} className="text-slate-400" /></div>
      {rows.length ? <div className="divide-y divide-slate-100">{rows.map((incident) => {
        const website = Array.isArray(incident.websites) ? incident.websites[0] : incident.websites;
        const isOpen = ["open", "acknowledged", "investigating"].includes(incident.status);
        return <article key={incident.id} className="flex flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${isOpen ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{isOpen ? <CircleAlert size={16} /> : <CheckCircle2 size={16} />}</span>
          <div className="min-w-0 flex-1"><p className="text-xs font-semibold text-slate-800">{incident.summary}</p><p className="mt-1 text-[10px] capitalize text-slate-500">{website?.name ?? "Archived website"} · {incident.incident_type.replaceAll("_", " ")} · {incident.severity}</p><p className="mt-1 text-[10px] text-slate-400">Started {formatDate(incident.started_at, context.timeZone)} · Last observed {formatDate(incident.last_observed_at, context.timeZone)} · {incident.occurrence_count} observation(s)</p></div>
          <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold capitalize text-slate-600">{incident.status}</span>{isOpen && incident.website_id && <Link href={`/websites/${incident.website_id}`} className="rounded-md border border-slate-200 px-2.5 py-1.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-50">Website</Link>}
            {isOpen && <div className="flex gap-2">{incident.status === "open" && <StatusForm id={incident.id} status="acknowledged" label="Acknowledge" />}{incident.status !== "investigating" && <StatusForm id={incident.id} status="investigating" label="Investigate" />}{can(context.role, "manage_monitoring") && <StatusForm id={incident.id} status="resolved" label="Resolve" />}</div>}
          </div>
        </article>;
      })}</div> : <div className="px-6 py-14 text-center"><CheckCircle2 size={23} className="mx-auto text-emerald-500" /><p className="mt-3 text-sm font-semibold text-slate-700">No incidents recorded</p><p className="mt-1 text-xs text-slate-400">Outages and certificate issues will appear here when checks are active.</p></div>}
    </section>
  </div></main>;
}

function StatusForm({ id, status, label }: { id: string; status: "acknowledged" | "investigating" | "resolved"; label: string }) {
  return <form action={changeIncidentStatus}><input type="hidden" name="incidentId" value={id} /><input type="hidden" name="status" value={status} /><button type="submit" className="rounded-md bg-blue-600 px-2.5 py-1.5 text-[10px] font-semibold text-white hover:bg-blue-700">{label}</button></form>;
}

function formatDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(value));
}

function IncidentsLoading() {
  return <main className="min-h-screen bg-[#f5f7fa] px-5 py-8"><div className="mx-auto max-w-6xl animate-pulse"><div className="h-7 w-48 rounded bg-slate-200" /><div className="mt-7 h-[600px] rounded-xl border border-slate-200 bg-white" /></div></main>;
}
