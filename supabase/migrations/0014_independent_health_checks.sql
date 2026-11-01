-- Track independent performance devices and certificate checks for the
-- website's primary HTTPS URL so newly added targets are scanned immediately.
alter table public.websites
  add column if not exists performance_desktop_checked_at timestamptz,
  add column if not exists ssl_checked_at timestamptz;

create index if not exists websites_desktop_performance_due_idx
  on public.websites (performance_desktop_checked_at nulls first)
  where active = true;

create index if not exists websites_ssl_due_idx
  on public.websites (ssl_checked_at nulls first)
  where active = true;
