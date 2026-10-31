import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ArrowLeft, Building2, Plus, Search } from "lucide-react";
import { createClientRecord } from "@/app/clients/actions";
import { ClientFields } from "@/app/_components/record-fields";
import { can } from "@/lib/auth/roles";
import { getRequestAuthContext } from "@/lib/auth/session";
import { lifecycleLabel, parseLifecycleFilter, type LifecycleStatus } from "@/lib/lifecycle/status";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Clients" };

export default function ClientsPage(props: { searchParams: Promise<{ q?: string; status?: string; error?: string; success?: string }> }) {
  return <Suspense fallback={<ClientsLoading />}><ClientsContent searchParams={props.searchParams} /></Suspense>;
}

async function ClientsContent({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; error?: string; success?: string }> }) {
  const context = await getRequestAuthContext();
  if (!context) redirect("/login");
  if (!context.organizationId) redirect("/setup");
  const { q = "", error, success, status: rawStatus } = await searchParams;
  const query = q.trim().slice(0, 100);
  const status = parseLifecycleFilter(rawStatus);
  const supabase = await createClient();
  let clientQuery = supabase
    .from("clients")
    .select("id, name, contact_name, contact_email, lifecycle_status, updated_at")
    .eq("organization_id", context.organizationId)
    .order("name", { ascending: true });
  if (query) clientQuery = clientQuery.ilike("name", `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`);
  const { data: clients, error: queryError } = await clientQuery;
  if (queryError) {
    console.error("Clients query failed", { code: queryError.code });
    throw new Error("Client records could not be loaded.");
  }
  const visibleClients = (clients ?? []).filter((client) => status === "all" || client.lifecycle_status === status);

  return (
    <main className="min-h-screen bg-white px-5 py-7 sm:px-8 sm:py-9">
      <div className="mx-auto max-w-6xl">
        <Link href="/" className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-900"><ArrowLeft size={14} /> Overview</Link>
        <div className="mt-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div><h1 className="text-xl font-bold tracking-tight text-slate-950">Clients</h1><p className="mt-1 text-sm text-slate-500">Manage client accounts and their monitored websites.</p></div>
          <form action="/clients" className="flex flex-wrap gap-2">
            <label htmlFor="client-search" className="sr-only">Search clients</label>
            <span className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input id="client-search" name="q" defaultValue={query} placeholder="Search clients" className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-xs outline-none focus:border-red-500 sm:w-56" /></span>
            <label htmlFor="client-status" className="sr-only">Filter clients by status</label><select id="client-status" name="status" defaultValue={status} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-600"><option value="active">Active</option><option value="on_hold">On hold</option><option value="transferred">Transferred</option><option value="archived">Archived</option><option value="all">All statuses</option></select>
            <button type="submit" className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50">Search</button>
          </form>
        </div>
        {error && <p role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{error === "forbidden" ? "Your role cannot manage clients." : error === "invalid" ? "Check the submitted client details." : "The client change could not be saved."}</p>}
        {success && <p role="status" className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">Client status updated; history was retained.</p>}

        <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_300px]">
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="text-sm font-bold text-slate-900">Client directory</h2><p className="mt-0.5 text-[11px] text-slate-400">{visibleClients.length} {status === "all" ? "clients" : `${lifecycleLabel(status as LifecycleStatus).toLowerCase()} clients`}</p></div><Building2 size={16} className="text-slate-400" /></div>
            {visibleClients.length ? <div className="divide-y divide-slate-100">
              {visibleClients.map((client) => <Link key={client.id} href={`/clients/${client.id}`} className="flex items-center gap-3 px-5 py-4 hover:bg-slate-50/70">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-50 text-red-700"><Building2 size={16} /></span>
                <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-slate-800">{client.name}</span><span className="mt-1 block truncate text-[11px] text-slate-400">{client.contact_name || client.contact_email || "No contact details"} </span></span>
                <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${client.lifecycle_status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{lifecycleLabel(client.lifecycle_status as LifecycleStatus)}</span>
                <span className="text-[10px] text-slate-400">Updated {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(client.updated_at))}</span>
              </Link>)}
            </div> : <div className="px-6 py-14 text-center"><Building2 size={22} className="mx-auto text-slate-300" /><p className="mt-3 text-sm font-semibold text-slate-700">{query ? "No matching clients" : "No clients in this status"}</p><p className="mt-1 text-xs text-slate-400">Change the status filter or add a new client.</p></div>}
          </section>

          {can(context.role, "manage_clients") && <section className="h-fit rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-50 text-red-700"><Plus size={15} /></span><h2 className="text-sm font-bold text-slate-900">Add client</h2></div>
            <form action={createClientRecord} className="mt-4 space-y-3">
              <ClientFields />
              <button type="submit" className="h-10 w-full rounded-lg bg-red-600 px-4 text-xs font-semibold text-white hover:bg-red-700">Create client</button>
            </form>
          </section>}
        </div>
      </div>
    </main>
  );
}

function ClientsLoading() {
  return <main className="min-h-screen bg-white px-5 py-8"><div className="mx-auto max-w-6xl animate-pulse"><div className="h-7 w-40 rounded bg-slate-200" /><div className="mt-7 h-96 rounded-xl border border-slate-200 bg-white" /></div></main>;
}
