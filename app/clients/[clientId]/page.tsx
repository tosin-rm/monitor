import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, Globe2 } from "lucide-react";
import { archiveClient, updateClientRecord } from "@/app/clients/actions";
import { ClientFields } from "@/app/_components/record-fields";
import { ConfirmSubmit } from "@/app/_components/confirm-submit";
import { can } from "@/lib/auth/roles";
import { getRequestAuthContext } from "@/lib/auth/session";
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
    supabase.from("clients").select("id, name, contact_name, contact_email, contact_phone, notes, active").eq("id", clientId).eq("organization_id", context.organizationId).eq("active", true).maybeSingle(),
    supabase.from("websites").select("id, name, primary_url, environment, active").eq("client_id", clientId).eq("organization_id", context.organizationId).eq("active", true).order("name"),
  ]);
  if (clientResult.error || websitesResult.error) {
    console.error("Client detail query failed", [clientResult.error?.code, websitesResult.error?.code].filter(Boolean));
    throw new Error("Client details could not be loaded.");
  }
  if (!clientResult.data) notFound();
  const client = clientResult.data;

  return <main className="min-h-screen bg-white px-5 py-7 sm:px-8 sm:py-9"><div className="mx-auto max-w-5xl">
    <Link href="/clients" className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-900"><ArrowLeft size={14} /> Clients</Link>
    <div className="mt-6"><h1 className="text-xl font-bold tracking-tight text-slate-950">{client.name}</h1><p className="mt-1 text-sm text-slate-500">Client details and associated websites.</p></div>
    {query.error && <p role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{query.error === "archive" ? "Client could not be archived." : "Client changes could not be saved."}</p>}
    {query.success && <p role="status" className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">Client details saved.</p>}
    <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_1fr]">
      <section className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="text-sm font-bold text-slate-900">Client information</h2>
        {can(context.role, "manage_clients") ? <form action={updateClientRecord} className="mt-4 space-y-3"><input type="hidden" name="clientId" value={client.id} /><ClientFields client={client} /><button type="submit" className="h-10 w-full rounded-lg bg-red-600 px-4 text-xs font-semibold text-white hover:bg-red-700">Save changes</button></form> : <dl className="mt-4 space-y-3 text-xs"><Detail label="Contact" value={client.contact_name} /><Detail label="Email" value={client.contact_email} /><Detail label="Phone" value={client.contact_phone} /><Detail label="Notes" value={client.notes} /></dl>}
        {can(context.role, "manage_clients") && <form action={archiveClient} className="mt-5 border-t border-slate-100 pt-4"><input type="hidden" name="clientId" value={client.id} /><ConfirmSubmit type="submit" confirmation={`Archive ${client.name}? Its websites and monitoring will be deactivated, while all history is retained.`} className="h-9 rounded-lg border border-red-200 px-3 text-xs font-semibold text-red-700 hover:bg-red-50">Archive client</ConfirmSubmit></form>}
      </section>
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="text-sm font-bold text-slate-900">Websites</h2><p className="mt-0.5 text-[11px] text-slate-400">{websitesResult.data?.length ?? 0} active websites</p></div><Globe2 size={16} className="text-slate-400" /></div>
        {websitesResult.data?.length ? <div className="divide-y divide-slate-100">{websitesResult.data.map((website) => <Link key={website.id} href={`/websites/${website.id}`} className="block px-5 py-4 hover:bg-slate-50"><p className="text-xs font-semibold text-slate-800">{website.name}</p><p className="mt-1 truncate text-[11px] text-red-700">{website.primary_url}</p><p className="mt-1 text-[10px] capitalize text-slate-400">{website.environment}</p></Link>)}</div> : <p className="px-5 py-8 text-xs text-slate-400">No active websites for this client.</p>}
        {can(context.role, "manage_websites") && <div className="border-t border-slate-100 px-5 py-3"><Link href={`/websites?client=${client.id}`} className="text-xs font-semibold text-red-700 hover:text-red-800">Add or manage websites</Link></div>}
      </section>
    </div>
  </div></main>;
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return <div><dt className="font-semibold text-slate-500">{label}</dt><dd className="mt-1 whitespace-pre-wrap text-slate-800">{value || "Not provided"}</dd></div>;
}
