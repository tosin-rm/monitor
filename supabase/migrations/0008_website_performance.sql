-- Daily Lighthouse lab metrics and available field Core Web Vitals.
alter table public.websites add column if not exists performance_checked_at timestamptz;
alter table public.websites add column if not exists platform text not null default 'unknown'
  check (platform in ('wordpress', 'nextjs', 'other', 'unknown'));
create index websites_performance_due_idx
  on public.websites (performance_checked_at nulls first)
  where active = true;

alter table public.check_results
  add column if not exists website_id uuid references public.websites (id) on delete cascade;

alter table public.check_results
  drop constraint check_results_target;

alter table public.check_results
  add constraint check_results_target check (
    endpoint_id is not null
    or asset_id is not null
    or website_id is not null
    or check_type = 'worker_health'
  );

alter table public.check_results
  add constraint check_results_performance_target check (
    check_type <> 'performance' or (endpoint_id is null and asset_id is null and website_id is not null)
  );

create index check_results_performance_org_checked_idx
  on public.check_results (organization_id, checked_at desc)
  where check_type = 'performance';
create index check_results_website_checked_idx
  on public.check_results (website_id, checked_at desc)
  where website_id is not null;

insert into public.job_leases (job_name) values ('performance_check') on conflict do nothing;
