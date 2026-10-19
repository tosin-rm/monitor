export function ClientFields({ client }: {
  client?: {
    name?: string;
    contact_name?: string | null;
    contact_email?: string | null;
    contact_phone?: string | null;
    notes?: string | null;
  };
}) {
  return <>
    <Field label="Client name" name="name" defaultValue={client?.name} required maxLength={160} />
    <Field label="Contact name" name="contactName" defaultValue={client?.contact_name ?? ""} maxLength={160} />
    <Field label="Contact email" name="contactEmail" type="email" defaultValue={client?.contact_email ?? ""} maxLength={254} />
    <Field label="Contact phone" name="contactPhone" type="tel" defaultValue={client?.contact_phone ?? ""} maxLength={80} />
    <div><label htmlFor="notes" className="mb-1.5 block text-[11px] font-semibold text-slate-700">Internal notes</label><textarea id="notes" name="notes" defaultValue={client?.notes ?? ""} maxLength={4000} rows={3} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100" /></div>
  </>;
}

function Field({ label, name, defaultValue, type = "text", required, maxLength }: {
  label: string;
  name: string;
  defaultValue?: string;
  type?: string;
  required?: boolean;
  maxLength: number;
}) {
  return <div><label htmlFor={name} className="mb-1.5 block text-[11px] font-semibold text-slate-700">{label}</label><input id={name} name={name} type={type} defaultValue={defaultValue} required={required} maxLength={maxLength} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100" /></div>;
}

export function WebsiteFields({ clients, website, selectedClient }: {
  clients: Array<{ id: string; name: string }>;
  website?: { name: string; primary_url: string; environment: string; client_id: string };
  selectedClient?: string;
}) {
  return <>
    <div><label htmlFor="clientId" className="mb-1.5 block text-[11px] font-semibold text-slate-700">Client</label><select id="clientId" name="clientId" required defaultValue={website?.client_id ?? selectedClient ?? ""} className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none focus:border-red-500">{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></div>
    <div><label htmlFor="website-name" className="mb-1.5 block text-[11px] font-semibold text-slate-700">Website name</label><input id="website-name" name="name" required maxLength={160} defaultValue={website?.name} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100" placeholder="Marketing site" /></div>
    <div><label htmlFor="primaryUrl" className="mb-1.5 block text-[11px] font-semibold text-slate-700">Primary URL</label><input id="primaryUrl" name="primaryUrl" type="url" required maxLength={2048} defaultValue={website?.primary_url} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100" placeholder="https://example.com" /></div>
    <div><label htmlFor="environment" className="mb-1.5 block text-[11px] font-semibold text-slate-700">Environment</label><select id="environment" name="environment" defaultValue={website?.environment ?? "production"} className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs">{["production", "staging", "development", "other"].map((value) => <option key={value} value={value}>{value[0]!.toUpperCase() + value.slice(1)}</option>)}</select></div>
  </>;
}

export function AssetFields({ asset, idPrefix = "asset" }: {
  asset?: {
    asset_type: string;
    service_name: string | null;
    hostname: string | null;
    provider_name: string | null;
    provider_account_reference: string | null;
    expiry_date: string | null;
    renewal_url: string | null;
    renewal_responsibility: string | null;
    renewal_status: string;
    last_verified_at: string | null;
  };
  idPrefix?: string;
}) {
  return <>
    <div><label htmlFor={`${idPrefix}-type`} className="mb-1.5 block text-[11px] font-semibold text-slate-700">Service type</label><select id={`${idPrefix}-type`} name="assetType" defaultValue={asset?.asset_type ?? "domain"} className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs">{[["domain", "Domain"], ["hosting", "Hosting"], ["ssl_certificate", "SSL certificate"], ["other", "Other"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
    <div><label htmlFor={`${idPrefix}-service`} className="mb-1.5 block text-[11px] font-semibold text-slate-700">Service name</label><input id={`${idPrefix}-service`} name="serviceName" defaultValue={asset?.service_name ?? ""} maxLength={200} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-xs" placeholder="Primary domain" /></div>
    <div><label htmlFor={`${idPrefix}-hostname`} className="mb-1.5 block text-[11px] font-semibold text-slate-700">Domain or hostname</label><input id={`${idPrefix}-hostname`} name="hostname" defaultValue={asset?.hostname ?? ""} maxLength={253} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-xs" placeholder="example.com" /></div>
    <div><label htmlFor={`${idPrefix}-provider`} className="mb-1.5 block text-[11px] font-semibold text-slate-700">Provider</label><input id={`${idPrefix}-provider`} name="providerName" defaultValue={asset?.provider_name ?? ""} maxLength={160} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-xs" placeholder="Registrar or hosting provider" /></div>
    <div><label htmlFor={`${idPrefix}-account`} className="mb-1.5 block text-[11px] font-semibold text-slate-700">Provider account reference</label><input id={`${idPrefix}-account`} name="providerAccountReference" defaultValue={asset?.provider_account_reference ?? ""} maxLength={200} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-xs" /></div>
    <div><label htmlFor={`${idPrefix}-expiry`} className="mb-1.5 block text-[11px] font-semibold text-slate-700">Expiry date</label><input id={`${idPrefix}-expiry`} name="expiryDate" type="date" defaultValue={asset?.expiry_date ?? ""} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-xs" /></div>
    <div><label htmlFor={`${idPrefix}-renewal-url`} className="mb-1.5 block text-[11px] font-semibold text-slate-700">Renewal URL</label><input id={`${idPrefix}-renewal-url`} name="renewalUrl" type="url" defaultValue={asset?.renewal_url ?? ""} maxLength={2048} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-xs" placeholder="https://provider.example/renew" /></div>
    <div><label htmlFor={`${idPrefix}-responsibility`} className="mb-1.5 block text-[11px] font-semibold text-slate-700">Renewal responsibility</label><input id={`${idPrefix}-responsibility`} name="renewalResponsibility" defaultValue={asset?.renewal_responsibility ?? ""} maxLength={160} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-xs" placeholder="Team member or client" /></div>
    <div><label htmlFor={`${idPrefix}-status`} className="mb-1.5 block text-[11px] font-semibold text-slate-700">Renewal status</label><select id={`${idPrefix}-status`} name="renewalStatus" defaultValue={asset?.renewal_status ?? "unknown"} className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs">{["active", "renewal_pending", "renewed", "expired", "cancelled", "unknown"].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></div>
    <label className="flex items-center gap-2 text-[10px] text-slate-600 sm:col-span-2"><input type="checkbox" name="verified" defaultChecked={Boolean(asset?.last_verified_at)} className="rounded border-slate-300 text-red-600 focus:ring-red-500" /> I have verified the manually entered expiry date with the provider.</label>
    <p className="text-[10px] leading-4 text-slate-400 sm:col-span-2">An unknown expiry is kept blank. Hosting subscription dates are manually maintained unless an official provider API is added.</p>
  </>;
}
