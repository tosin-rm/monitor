-- Monitor: identity, inventory, monitoring, notifications, jobs
-- All tables are organization-scoped and protected by RLS.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.member_role as enum ('owner', 'admin', 'member');

create type public.asset_type as enum (
  'domain',
  'hosting',
  'ssl_certificate',
  'other'
);

create type public.renewal_status as enum (
  'active',
  'renewal_pending',
  'renewed',
  'expired',
  'cancelled',
  'unknown'
);

-- date_source records how the current expiry_date was obtained.
create type public.date_source as enum (
  'manual',
  'rdap',
  'provider_api',
  'certificate_inspection',
  'unknown'
);

create type public.website_environment as enum (
  'production',
  'staging',
  'development',
  'other'
);

create type public.incident_type as enum (
  'outage',
  'ssl_invalid',
  'expiry',
  'worker_health'
);

create type public.incident_severity as enum (
  'info',
  'warning',
  'critical'
);

create type public.incident_status as enum (
  'open',
  'acknowledged',
  'investigating',
  'resolved',
  'suppressed'
);

create type public.notification_channel as enum (
  'email',
  'telegram',
  'whatsapp'
);

create type public.notification_status as enum (
  'queued',
  'sending',
  'accepted',
  'delivered',
  'failed',
  'cancelled'
);

create type public.check_type as enum (
  'http',
  'ssl',
  'rdap',
  'worker_health'
);

create type public.job_name as enum (
  'expiry_eval',
  'rdap_refresh',
  'ssl_check',
  'uptime_check',
  'notification_dispatch',
  'worker_health',
  'check_retention'
);

create type public.confirmation_method as enum (
  'manual',
  'rdap',
  'provider_api',
  'certificate_inspection'
);

-- ---------------------------------------------------------------------------
-- Updated-at trigger
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Organizations and membership
-- ---------------------------------------------------------------------------

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 120),
  timezone text not null default 'Europe/London',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger organizations_set_updated_at
before update on public.organizations
for each row execute procedure public.set_updated_at();

create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null,
  email text not null,
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index organization_members_user_id_idx on public.organization_members (user_id);
create index organization_members_org_id_idx on public.organization_members (organization_id);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email text not null,
  role public.member_role not null check (role in ('admin', 'member')),
  invited_by uuid not null references auth.users (id) on delete cascade,
  supabase_user_id uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index invitations_pending_email_org_idx
  on public.invitations (organization_id, lower(email))
  where accepted_at is null and revoked_at is null;

-- ---------------------------------------------------------------------------
-- RLS helper functions (security definer to avoid recursive policies)
-- ---------------------------------------------------------------------------

create or replace function public.role_rank(r public.member_role)
returns integer
language sql
immutable
as $$
  select case r
    when 'owner' then 3
    when 'admin' then 2
    when 'member' then 1
    else 0
  end;
$$;

create or replace function public.is_org_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = p_org
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.has_min_role(p_org uuid, p_min public.member_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = p_org
      and m.user_id = auth.uid()
      and public.role_rank(m.role) >= public.role_rank(p_min)
  );
$$;

create or replace function public.current_member_role(p_org uuid)
returns public.member_role
language sql
stable
security definer
set search_path = public
as $$
  select m.role
  from public.organization_members m
  where m.organization_id = p_org
    and m.user_id = auth.uid()
  limit 1;
$$;

revoke all on function public.is_org_member(uuid) from public;
revoke all on function public.has_min_role(uuid, public.member_role) from public;
revoke all on function public.current_member_role(uuid) from public;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_min_role(uuid, public.member_role) to authenticated;
grant execute on function public.current_member_role(uuid) to authenticated;

-- Prevent removing the last owner.
create or replace function public.organization_members_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_count integer;
begin
  if tg_op = 'DELETE' then
    if old.role = 'owner' then
      select count(*) into owner_count
      from public.organization_members
      where organization_id = old.organization_id
        and role = 'owner'
        and id <> old.id;
      if owner_count < 1 then
        raise exception 'Cannot remove the last owner';
      end if;
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if old.role = 'owner' and new.role <> 'owner' then
      select count(*) into owner_count
      from public.organization_members
      where organization_id = old.organization_id
        and role = 'owner'
        and id <> old.id;
      if owner_count < 1 then
        raise exception 'Cannot demote the last owner';
      end if;
    end if;
  end if;

  return new;
end;
$$;

create trigger organization_members_guard
before update or delete on public.organization_members
for each row execute procedure public.organization_members_guard();

-- ---------------------------------------------------------------------------
-- Inventory
-- ---------------------------------------------------------------------------

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 160),
  contact_name text,
  contact_email text,
  contact_phone text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index clients_org_name_idx on public.clients (organization_id, lower(name));
create trigger clients_set_updated_at
before update on public.clients
for each row execute procedure public.set_updated_at();

create table public.websites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete restrict,
  name text not null check (char_length(trim(name)) between 1 and 160),
  primary_url text not null,
  environment public.website_environment not null default 'production',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index websites_org_client_idx on public.websites (organization_id, client_id);
create trigger websites_set_updated_at
before update on public.websites
for each row execute procedure public.set_updated_at();

-- assets: individually monitored infrastructure services.
-- expiry_date is a calendar date in the organization timezone, not a timestamp.
create table public.assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  website_id uuid not null references public.websites (id) on delete restrict,
  asset_type public.asset_type not null,
  provider_name text,
  provider_account_reference text,
  service_name text,
  hostname text,
  expiry_date date,
  renewal_url text,
  renewal_responsibility text,
  renewal_status public.renewal_status not null default 'unknown',
  date_source public.date_source not null default 'unknown',
  last_verified_at timestamptz,
  last_checked_at timestamptz,
  last_check_error text,
  date_confidence text check (date_confidence in ('high', 'medium', 'low', 'none') or date_confidence is null),
  manual_override boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index assets_org_expiry_idx on public.assets (organization_id, expiry_date)
  where active = true;
create index assets_org_type_idx on public.assets (organization_id, asset_type);
create trigger assets_set_updated_at
before update on public.assets
for each row execute procedure public.set_updated_at();

create table public.renewal_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  asset_id uuid not null references public.assets (id) on delete restrict,
  previous_expiry_date date,
  new_expiry_date date,
  confirmation_method public.confirmation_method not null,
  confirmed_by uuid references auth.users (id) on delete set null,
  confirmation_notes text,
  created_at timestamptz not null default now()
);

create index renewal_history_asset_idx on public.renewal_history (asset_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Monitoring
-- ---------------------------------------------------------------------------

create table public.monitoring_endpoints (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  website_id uuid not null references public.websites (id) on delete restrict,
  endpoint_url text not null,
  expected_status_codes integer[] not null default '{200,201,204,301,302}',
  check_interval_seconds integer not null default 300 check (check_interval_seconds >= 60),
  timeout_seconds integer not null default 15 check (timeout_seconds between 1 and 60),
  follow_redirects boolean not null default true,
  max_redirects integer not null default 3 check (max_redirects between 0 and 5),
  consecutive_failure_threshold integer not null default 2 check (consecutive_failure_threshold between 1 and 10),
  enabled boolean not null default true,
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  consecutive_failures integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.enforce_org_ownership()
returns trigger
language plpgsql
as $$
declare
  parent_org uuid;
begin
  if tg_table_name = 'websites' then
    select organization_id into parent_org from public.clients where id = new.client_id;
    if parent_org is distinct from new.organization_id then
      raise exception 'website organization_id must match client';
    end if;
  elsif tg_table_name = 'assets' then
    select organization_id into parent_org from public.websites where id = new.website_id;
    if parent_org is distinct from new.organization_id then
      raise exception 'asset organization_id must match website';
    end if;
  elsif tg_table_name = 'monitoring_endpoints' then
    select organization_id into parent_org from public.websites where id = new.website_id;
    if parent_org is distinct from new.organization_id then
      raise exception 'endpoint organization_id must match website';
    end if;
  end if;
  return new;
end;
$$;

create trigger websites_org_guard
before insert or update on public.websites
for each row execute procedure public.enforce_org_ownership();

create trigger assets_org_guard
before insert or update on public.assets
for each row execute procedure public.enforce_org_ownership();

create trigger endpoints_org_guard
before insert or update on public.monitoring_endpoints
for each row execute procedure public.enforce_org_ownership();

create index monitoring_endpoints_due_idx
  on public.monitoring_endpoints (enabled, last_checked_at, check_interval_seconds);
create trigger monitoring_endpoints_set_updated_at
before update on public.monitoring_endpoints
for each row execute procedure public.set_updated_at();

-- metadata must remain a small, documented object. Application code sanitizes it.
create table public.check_results (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  endpoint_id uuid references public.monitoring_endpoints (id) on delete cascade,
  asset_id uuid references public.assets (id) on delete cascade,
  website_id uuid references public.websites (id) on delete cascade,
  check_type public.check_type not null,
  checked_at timestamptz not null default now(),
  success boolean not null,
  http_status integer,
  response_time_ms integer,
  certificate_not_after timestamptz,
  error_code text,
  sanitized_error_message text,
  metadata jsonb not null default '{}'::jsonb,
  constraint check_results_target check (
    endpoint_id is not null
    or asset_id is not null
    or website_id is not null
    or check_type = 'worker_health'
  )
);

create index check_results_endpoint_checked_idx
  on public.check_results (endpoint_id, checked_at desc);
create index check_results_asset_checked_idx
  on public.check_results (asset_id, checked_at desc);
create index check_results_org_checked_idx
  on public.check_results (organization_id, checked_at desc);

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  website_id uuid references public.websites (id) on delete set null,
  endpoint_id uuid references public.monitoring_endpoints (id) on delete set null,
  asset_id uuid references public.assets (id) on delete set null,
  incident_type public.incident_type not null,
  severity public.incident_severity not null,
  status public.incident_status not null default 'open',
  started_at timestamptz not null default now(),
  last_observed_at timestamptz not null default now(),
  resolved_at timestamptz,
  occurrence_count integer not null default 1,
  summary text not null,
  assigned_to uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index incidents_open_idx
  on public.incidents (organization_id, status, started_at desc);
create unique index incidents_one_open_outage_idx
  on public.incidents (organization_id, endpoint_id)
  where incident_type = 'outage' and status in ('open', 'acknowledged', 'investigating');
create trigger incidents_set_updated_at
before update on public.incidents
for each row execute procedure public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Notifications (durable outbox)
-- ---------------------------------------------------------------------------

create table public.notification_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  email_enabled boolean not null default true,
  telegram_enabled boolean not null default false,
  whatsapp_enabled boolean not null default false,
  email_recipients text[] not null default '{}',
  telegram_chat_ids text[] not null default '{}',
  reminder_intervals jsonb not null default jsonb_build_object(
    'domain', jsonb_build_array(30, 14, 7, 3, 1),
    'hosting', jsonb_build_array(30, 14, 7, 3, 1),
    'ssl_certificate', jsonb_build_array(14, 7, 3, 1),
    'expired_followup_days', jsonb_build_array(0, 3, 7, 14)
  ),
  incident_failure_threshold integer not null default 2,
  escalate_after_minutes integer,
  quiet_hours_enabled boolean not null default false,
  quiet_hours_start time,
  quiet_hours_end time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger notification_settings_set_updated_at
before update on public.notification_settings
for each row execute procedure public.set_updated_at();

-- One-time codes for associating a Telegram chat. The plaintext code is never stored.
create table public.telegram_link_challenges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  code_hash text not null unique,
  created_by uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  incident_id uuid references public.incidents (id) on delete set null,
  asset_id uuid references public.assets (id) on delete set null,
  event_type text not null,
  channel public.notification_channel not null,
  recipient_reference text not null,
  deduplication_key text not null,
  status public.notification_status not null default 'queued',
  attempts integer not null default 0,
  max_attempts integer not null default 8,
  scheduled_at timestamptz not null default now(),
  sent_at timestamptz,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  provider_message_id text,
  sanitized_error text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Concurrent jobs cannot insert the same logical reminder twice.
create unique index notifications_dedupe_idx
  on public.notifications (organization_id, deduplication_key);
create index notifications_dispatch_idx
  on public.notifications (status, next_attempt_at)
  where status in ('queued', 'failed');
create trigger notifications_set_updated_at
before update on public.notifications
for each row execute procedure public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Audit, jobs, leases
-- ---------------------------------------------------------------------------

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_org_created_idx
  on public.audit_logs (organization_id, created_at desc);

create table public.job_runs (
  id uuid primary key default gen_random_uuid(),
  job_name public.job_name not null,
  organization_id uuid references public.organizations (id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  success boolean,
  processed_count integer not null default 0,
  error_count integer not null default 0,
  duration_ms integer,
  sanitized_error text,
  metadata jsonb not null default '{}'::jsonb
);

create index job_runs_name_started_idx on public.job_runs (job_name, started_at desc);

create table public.job_leases (
  job_name text primary key,
  locked_until timestamptz,
  locked_by text,
  updated_at timestamptz not null default now()
);

insert into public.job_leases (job_name)
values
  ('expiry_eval'),
  ('rdap_refresh'),
  ('ssl_check'),
  ('uptime_check'),
  ('notification_dispatch'),
  ('worker_health'),
  ('check_retention');

create or replace function public.try_acquire_job_lease(
  p_job_name text,
  p_locked_by text,
  p_lease_seconds integer default 240
)
returns boolean
language plpgsql
as $$
declare
  updated integer;
begin
  update public.job_leases
  set
    locked_until = now() + make_interval(secs => p_lease_seconds),
    locked_by = p_locked_by,
    updated_at = now()
  where job_name = p_job_name
    and (locked_until is null or locked_until < now());
  get diagnostics updated = row_count;
  return updated = 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.invitations enable row level security;
alter table public.clients enable row level security;
alter table public.websites enable row level security;
alter table public.assets enable row level security;
alter table public.renewal_history enable row level security;
alter table public.monitoring_endpoints enable row level security;
alter table public.check_results enable row level security;
alter table public.incidents enable row level security;
alter table public.notification_settings enable row level security;
alter table public.telegram_link_challenges enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;
alter table public.job_runs enable row level security;
alter table public.job_leases enable row level security;

-- Organizations: members can read; only owners can update.
create policy organizations_select on public.organizations
  for select to authenticated
  using (public.is_org_member(id));

create policy organizations_update on public.organizations
  for update to authenticated
  using (public.has_min_role(id, 'owner'))
  with check (public.has_min_role(id, 'owner'));

-- Direct inserts of organizations are denied for authenticated users.
-- Bootstrap uses the service role.
create policy organizations_insert_deny on public.organizations
  for insert to authenticated
  with check (false);

create policy organization_members_select on public.organization_members
  for select to authenticated
  using (public.is_org_member(organization_id));

-- Membership mutations go through service-role server actions.
create policy organization_members_insert_deny on public.organization_members
  for insert to authenticated
  with check (false);
create policy organization_members_update_deny on public.organization_members
  for update to authenticated
  using (false);
create policy organization_members_delete_deny on public.organization_members
  for delete to authenticated
  using (false);

create policy invitations_select on public.invitations
  for select to authenticated
  using (public.has_min_role(organization_id, 'admin'));

create policy invitations_mutate_deny on public.invitations
  for insert to authenticated
  with check (false);

-- Operational data: members can read; admins manage writes except incident ack/renewals.

create policy clients_select on public.clients
  for select to authenticated
  using (public.is_org_member(organization_id));
create policy clients_insert on public.clients
  for insert to authenticated
  with check (public.has_min_role(organization_id, 'admin'));
create policy clients_update on public.clients
  for update to authenticated
  using (public.has_min_role(organization_id, 'admin'))
  with check (public.has_min_role(organization_id, 'admin'));
create policy clients_delete on public.clients
  for delete to authenticated
  using (false);

create policy websites_select on public.websites
  for select to authenticated
  using (public.is_org_member(organization_id));
create policy websites_insert on public.websites
  for insert to authenticated
  with check (public.has_min_role(organization_id, 'admin'));
create policy websites_update on public.websites
  for update to authenticated
  using (public.has_min_role(organization_id, 'admin'))
  with check (public.has_min_role(organization_id, 'admin'));
create policy websites_delete on public.websites
  for delete to authenticated
  using (false);

create policy assets_select on public.assets
  for select to authenticated
  using (public.is_org_member(organization_id));
create policy assets_insert on public.assets
  for insert to authenticated
  with check (public.has_min_role(organization_id, 'admin'));
create policy assets_update on public.assets
  for update to authenticated
  using (public.has_min_role(organization_id, 'member'))
  with check (public.has_min_role(organization_id, 'member'));
create policy assets_delete on public.assets
  for delete to authenticated
  using (public.has_min_role(organization_id, 'admin'));

create policy renewal_history_select on public.renewal_history
  for select to authenticated
  using (public.is_org_member(organization_id));
create policy renewal_history_insert on public.renewal_history
  for insert to authenticated
  with check (public.has_min_role(organization_id, 'member'));

create policy endpoints_select on public.monitoring_endpoints
  for select to authenticated
  using (public.is_org_member(organization_id));
create policy endpoints_insert on public.monitoring_endpoints
  for insert to authenticated
  with check (public.has_min_role(organization_id, 'admin'));
create policy endpoints_update on public.monitoring_endpoints
  for update to authenticated
  using (public.has_min_role(organization_id, 'admin'))
  with check (public.has_min_role(organization_id, 'admin'));

create policy check_results_select on public.check_results
  for select to authenticated
  using (public.is_org_member(organization_id));
-- Writes are worker/service-role only.
create policy check_results_insert_deny on public.check_results
  for insert to authenticated
  with check (false);

create policy incidents_select on public.incidents
  for select to authenticated
  using (public.is_org_member(organization_id));
create policy incidents_update on public.incidents
  for update to authenticated
  using (public.has_min_role(organization_id, 'member'))
  with check (public.has_min_role(organization_id, 'member'));
create policy incidents_insert_deny on public.incidents
  for insert to authenticated
  with check (false);

create policy notification_settings_select on public.notification_settings
  for select to authenticated
  using (public.is_org_member(organization_id));
create policy notification_settings_update on public.notification_settings
  for update to authenticated
  using (public.has_min_role(organization_id, 'admin'))
  with check (public.has_min_role(organization_id, 'admin'));

create policy telegram_challenges_select on public.telegram_link_challenges
  for select to authenticated
  using (public.has_min_role(organization_id, 'admin'));

create policy notifications_select on public.notifications
  for select to authenticated
  using (public.is_org_member(organization_id));
create policy notifications_update on public.notifications
  for update to authenticated
  using (public.has_min_role(organization_id, 'admin'))
  with check (public.has_min_role(organization_id, 'admin'));
create policy notifications_insert_deny on public.notifications
  for insert to authenticated
  with check (false);

create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (public.has_min_role(organization_id, 'admin'));
create policy audit_logs_insert_deny on public.audit_logs
  for insert to authenticated
  with check (false);

create policy job_runs_select on public.job_runs
  for select to authenticated
  using (
    organization_id is null
    or public.has_min_role(organization_id, 'admin')
  );

-- Leases are service-role only.
create policy job_leases_deny on public.job_leases
  for all to authenticated
  using (false)
  with check (false);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, public;
grant usage on schema public to authenticated;

grant select, insert, update, delete on public.organizations to authenticated;
grant select on public.organization_members to authenticated;
grant select on public.invitations to authenticated;
grant select, insert, update on public.clients to authenticated;
grant select, insert, update on public.websites to authenticated;
grant select, insert, update, delete on public.assets to authenticated;
grant select, insert on public.renewal_history to authenticated;
grant select, insert, update on public.monitoring_endpoints to authenticated;
grant select on public.check_results to authenticated;
grant select, update on public.incidents to authenticated;
grant select, update on public.notification_settings to authenticated;
grant select on public.telegram_link_challenges to authenticated;
grant select, update on public.notifications to authenticated;
grant select on public.audit_logs to authenticated;
grant select on public.job_runs to authenticated;

-- Service role (workers, privileged server actions) bypasses RLS automatically.
