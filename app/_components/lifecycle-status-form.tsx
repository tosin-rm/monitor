import { LIFECYCLE_STATUSES, lifecycleLabel, type LifecycleStatus } from "@/lib/lifecycle/status";

export function LifecycleStatusForm({
  action,
  entityField,
  entityId,
  status,
}: {
  action: (formData: FormData) => void | Promise<void>;
  entityField: "clientId" | "websiteId";
  entityId: string;
  status: LifecycleStatus;
}) {
  return <form action={action} className="mt-5 border-t border-slate-100 pt-4">
    <input type="hidden" name={entityField} value={entityId} />
    <label htmlFor={`${entityField}-lifecycle`} className="mb-1.5 block text-[11px] font-semibold text-slate-700">Lifecycle status</label>
    <div className="flex flex-wrap gap-2">
      <select id={`${entityField}-lifecycle`} name="status" defaultValue={status} className="h-9 min-w-36 rounded-lg border border-slate-200 bg-white px-3 text-xs">
        {LIFECYCLE_STATUSES.map((value) => <option key={value} value={value}>{lifecycleLabel(value)}</option>)}
      </select>
      <button type="submit" className="h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">Update status</button>
    </div>
    <p className="mt-2 text-[10px] leading-4 text-slate-500">On hold, transferred, and archived records keep their history and are excluded from monitoring. Set to Active to resume.</p>
  </form>;
}
