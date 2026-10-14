import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ArrowLeft, Globe2, Plus, Search } from "lucide-react";
import { createWebsite } from "@/app/websites/actions";
import { WebsiteFields } from "@/app/_components/record-fields";
import { can } from "@/lib/auth/roles";
import { getAuthContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Websites" };

export default function WebsitesPage(props: { searchParams: Promise<{ q?: string; client?: string; error?: string; success?: string }> }) {
  return <Suspense fallback={<WebsitesLoading />}><WebsitesContent searchParams={props.searchParams} /></Suspense>;
}

async function WebsitesContent({ searchParams }: { searchParams: Promise<{ q?: string; client?: string; error?: string; success?: string }> }) {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  if (!context.organizationId) redirect("/setup");
  const params = await searchParams;
  const search = (params.q ?? "").trim().slice(0, 100);
  const clientFilter = params.client ?? "";
  const supabase = await createClient();
  const [clientsResult, websitesResult] = await Promise.all([
    supabase.from("clients").select("id, name").eq("organization_id", context.organizationId).eq("active", true).order("name"),
    (async () => {
      let query = supabase.from("websites").select("id, name, primary_url, environment, client_id, client:clients(name)").eq("organization_id", context.organizationId).eq("active", true).order("name");
      if (search) query = query.ilike("name", `%${search.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`);
      if (clientFilter) query = query.eq("client_id", clientFilter);
      return query;
    })(),
  ]);
  if (clientsResult.error || websitesResult.error) {
    console.error("Website listing query failed", [clientsResult.error?.code, websitesResult.error?.code].filter(Boolean));
    throw new Error("Website inventory could not be loaded.");
  }

  return <main className="min-h-screen bg-[#f5f7fa] px-5 py-7 sm:px-8 sm:py-9"><div className="mx-auto max-w-6xl">
    <Link href="/" className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-900"><ArrowLeft size={14} /> Overview</Link>
    <div className="mt-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><h1 className="text-xl font-bold tracking-tight text-slate-950">Websites</h1><p className="mt-1 text-sm text-slate-500">Track service assets, uptime endpoints, and incidents by website.</p></div>
      <form action="/websites" className="flex flex-wrap gap-2">
        <label htmlFor="website-search" className="sr-only">Search websites</label><span className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input id="website-search" name="q" defaultValue={search} placeholder="Search websites" className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-xs outline-none focus:border-blue-500 sm:w-48" /></span>
        <label htmlFor="website-client" className="sr-only">Filter by client</label><select id="website-client" name="client" defaultValue={clientFilter} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-600"><option value="">All clients</option>{clientsResult.data?.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select>
        <button type="submit" className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50">Filter</button>
      </form>
    </div>
    {params.error && <p role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{params.error === "invalid" ? "Check the website details and URL. Only public HTTP/HTTPS URLs on ports 80 and 443 are accepted." : "Website changes could not be saved."}</p>}
    {params.success === "archived" && <p role="status" className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">Website archived; related monitoring was disabled and history retained.</p>}
    <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_320px]">
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="text-sm font-bold text-slate-900">Website inventory</h2><p className="mt-0.5 text-[11px] text-slate-400">{websitesResult.data?.length ?? 0} active websites</p></div><Globe2 size={16} className="text-slate-400" /></div>
        {websitesResult.data?.length ? <div className="divide-y divide-slate-100">{websitesResult.data.map((website) => { const client = Array.isArray(website.client) ? website.client[0] : website.client; return <Link key={website.id} href={`/websites/${website.id}`} className="flex items-center gap-3 px-5 py-4 hover:bg-slate-50"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><Globe2 size={16} /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-slate-800">{website.name}</span><span className="mt-1 block truncate text-[11px] text-blue-700">{website.primary_url}</span></span><span className="text-right"><span className="block text-[11px] text-slate-600">{client?.name ?? "Client"}</span><span className="mt-1 block text-[10px] capitalize text-slate-400">{website.environment}</span></span></Link>; })}</div> : <div className="px-6 py-14 text-center"><Globe2 size={22} className="mx-auto text-slate-300" /><p className="mt-3 text-sm font-semibold text-slate-700">{search || clientFilter ? "No matching websites" : "No websites yet"}</p><p className="mt-1 text-xs text-slate-400">Add an active website to begin monitoring its infrastructure.</p></div>}
      </section>
      {can(context.role, "manage_websites") && <section className="h-fit rounded-xl border border-slate-200 bg-white p-5"><div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><Plus size={15} /></span><h2 className="text-sm font-bold text-slate-900">Add website</h2></div>
        {clientsResult.data?.length ? <form action={createWebsite} className="mt-4 space-y-3"><WebsiteFields clients={clientsResult.data} selectedClient={clientFilter} /><button type="submit" className="h-10 w-full rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-700">Create website</button></form> : <p className="mt-4 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-500">Create a client record before adding its website.</p>}
      </section>}
    </div>
  </div></main>;
}

function WebsitesLoading() {
  return <main className="min-h-screen bg-[#f5f7fa] px-5 py-8"><div className="mx-auto max-w-6xl animate-pulse"><div className="h-7 w-40 rounded bg-slate-200" /><div className="mt-7 h-96 rounded-xl border border-slate-200 bg-white" /></div></main>;
}
