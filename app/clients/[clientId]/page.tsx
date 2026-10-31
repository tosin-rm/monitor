import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, Globe2 } from "lucide-react";
import { updateClientLifecycle, updateClientRecord } from "@/app/clients/actions";
import { ClientFields } from "@/app/_components/record-fields";
import { LifecycleStatusForm } from "@/app/_components/lifecycle-status-form";
import { can } from "@/lib/auth/roles";
import { getRequestAuthContext } from "@/lib/auth/session";
import { effectiveWebsiteStatus, lifecycleLabel, type LifecycleStatus } from "@/lib/lifecycle/status";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Client details" };

export default function ClientDetailPage(props: { params: Promise<{ clientId: string }>; searchParams: Promise<{ error?: string; success?: string }> }) {
  return <Suspense fallback={<main className="min-h-screen bg-white p-8"><div className="mx-auto h-96 max-w-5xl animate-pulse rounded-xl bg-white" /></main>}><ClientDetailContent params={props.params} searchParams={props.searchParams} /></Suspense>;
}

async function ClientDetailContent({ params, searchParams }: { params: Promise<{ clientId: string }>; searchParams: Promise<{ error?: string; success?: string }> }) {
  const context = await getRequestAuthContext();
  if (!context) redirect("/login");
  if (!context.organizationId) redirect("/setup");
  const [{ clientId }, query] = await Promise.all([params, searchParams]);
  const supabase = await createClient();
  const [clientResult, websitesResult] = await Promise.all([
    supabase.from("clients").select("id, name, contact_name, contact_email, contact_phone, notes, lifecycle_status").eq("id", clientId).eq("organization_id", context.organizationId).maybeSingle(),
    supabase.from("websites").select("id, name, primary_url, environment, lifecycle_status").eq("client_id", clientId).eq("organization_id", context.organizationId).order("name"),
  ]);
  if (clientResult.error || websitesResult.error) {
    console.error("Client detail query failed", [clientResult.error?.code, websitesResult.error?.code].filter(Boolean));
    throw new Error("Client details could not be loaded.");
  }
  if (!clientResult.data) notFound();
  const client = clientResult.data;
  const activeWebsiteCount = (websitesResult.data ?? []).filter((website) =>
    effectiveWebsiteStatus(website.lifecycle_status as LifecycleStatus, client.lifecycle_status as LifecycleStatus) === "active",
  ).length;

  return <main className="min-h-screen bg-white px-5 py-7 sm:px-8 sm:py-9"><div className="mx-auto max-w-5xl">
    <Link href="/clients" className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-900"><ArrowLeft size={14} /> Clients</Link>
    <div className="mt-6 flex items-center gap-3"><h1 className="text-xl font-bold tracking-tight text-slate-950">{client.name}</h1><span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${client.lifecycle_status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{lifecycleLabel(client.lifecycle_status as LifecycleStatus)}</span></div><p className="mt-1 text-sm text-slate-500">Client details and associated websites.</p>
    {client.lifecycle_status !== "active" && <p className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">Monitoring and expiry reminders are paused for this client and its websites. History is retained.</p>}
    {query.error && <p role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{query.error === "lifecycle" ? "Client status could not be updated." : "Client changes could not be saved."}</p>}
    {query.success === "lifecycle" && <p role="status" className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">Client status updated; history was retained.</p>}
    {query.success === "saved" && <p role="status" className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">Client details saved.</p>}
    <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_1fr]">
      <section className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="text-sm font-bold text-slate-900">Client information</h2>
        {can(context.role, "manage_clients") ? <form action={updateClientRecord} className="mt-4 space-y-3"><input type="hidden" name="clientId" value={client.id} /><ClientFields client={client} /><button type="submit" className="h-10 w-full rounded-lg bg-red-600 px-4 text-xs font-semibold text-white hover:bg-red-700">Save changes</button></form> : <dl className="mt-4 space-y-3 text-xs"><Detail label="Contact" value={client.contact_name} /><Detail label="Email" value={client.contact_email} /><Detail label="Phone" value={client.contact_phone} /><Detail label="Notes" value={client.notes} /></dl>}
        {can(context.role, "manage_clients") && <LifecycleStatusForm action={updateClientLifecycle} entityField="clientId" entityId={client.id} status={client.lifecycle_status as LifecycleStatus} />}
      </section>
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="text-sm font-bold text-slate-900">Websites</h2><p className="mt-0.5 text-[11px] text-slate-400">{activeWebsiteCount} active · {websitesResult.data?.length ?? 0} total</p></div><Globe2 size={16} className="text-slate-400" /></div>
        {websitesResult.data?.length ? <div className="divide-y divide-slate-100">{websitesResult.data.map((website) => {
          const status = effectiveWebsiteStatus(website.lifecycle_status as LifecycleStatus, client.lifecycle_status as LifecycleStatus);
          return <Link key={website.id} href={`/websites/${website.id}`} className="block px-5 py-4 hover:bg-slate-50"><div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold text-slate-800">{website.name}</p><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{lifecycleLabel(status)}</span></div><p className="mt-1 truncate text-[11px] text-red-700">{website.primary_url}</p><p className="mt-1 text-[10px] text-slate-400">{website.environment}</p></Link>;
        })}</div> : <p className="px-5 py-8 text-xs text-slate-400">No websites have been added for this client.</p>}
        {can(context.role, "manage_websites") && <div className="border-t border-slate-100 px-5 py-3"><Link href={`/websites?client=${client.id}`} className="text-xs font-semibold text-red-700 hover:text-red-800">Add or manage websites</Link></div>}
      </section>
    </div>
  </div></main>;
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return <div><dt className="font-semibold text-slate-500">{label}</dt><dd className="mt-1 whitespace-pre-wrap text-slate-800">{value || "Not provided"}</dd></div>;
}
