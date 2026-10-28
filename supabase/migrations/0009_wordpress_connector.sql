-- Read-only WordPress connector pairing, replay protection, and inventory history.
create table public.wordpress_connector_pairing_codes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  website_id uuid not null references public.websites(id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint wordpress_pair_code_expiry check (expires_at <= created_at + interval '20 minutes')
);
create index wordpress_pair_codes_expiry_idx on public.wordpress_connector_pairing_codes(expires_at);

create table public.wordpress_connectors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  website_id uuid not null references public.websites(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'revoked')),
  paired_at timestamptz not null default now(),
  last_report_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (website_id)
);

-- Secret material is isolated from the member-readable connection metadata table.
create table public.wordpress_connector_credentials (
  connector_id uuid primary key references public.wordpress_connectors(id) on delete cascade,
  secret_ciphertext text not null,
  updated_at timestamptz not null default now()
);

create table public.wordpress_connector_nonces (
  connector_id uuid not null references public.wordpress_connectors(id) on delete cascade,
  request_id uuid not null,
  received_at timestamptz not null default now(),
  primary key (connector_id, request_id)
);
create index wordpress_connector_nonces_received_idx on public.wordpress_connector_nonces(received_at);

create table public.wordpress_connector_rate_windows (
  connector_id uuid primary key references public.wordpress_connectors(id) on delete cascade,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count between 0 and 10)
);

create table public.wordpress_connector_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  website_id uuid not null references public.websites(id) on delete cascade,
  connector_id uuid not null references public.wordpress_connectors(id) on delete cascade,
  request_id uuid not null,
  schema_version integer not null,
  collected_at timestamptz not null,
  received_at timestamptz not null default now(),
  wordpress_version text not null,
  plugins jsonb not null,
  spam_comment_count integer not null check (spam_comment_count >= 0),
  unique (connector_id, request_id)
);
create index wordpress_connector_reports_website_received_idx
  on public.wordpress_connector_reports(website_id, received_at desc);
create index wordpress_connector_reports_received_idx
  on public.wordpress_connector_reports(received_at);

create or replace function public.save_wordpress_connector_report(
  p_connector_id uuid,
  p_request_id uuid,
  p_schema_version integer,
  p_collected_at timestamptz,
  p_wordpress_version text,
  p_plugins jsonb,
  p_spam_comment_count integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  connector_row public.wordpress_connectors;
  report_id uuid;
begin
  select * into connector_row
  from public.wordpress_connectors
  where id = p_connector_id and status = 'active'
  for update;
  if not found then raise exception 'Connector is inactive' using errcode = 'P0002'; end if;

  if not exists (
    select 1 from public.websites
    where id = connector_row.website_id
      and organization_id = connector_row.organization_id
      and active = true
      and platform = 'wordpress'
  ) then raise exception 'Website is inactive' using errcode = 'P0002'; end if;

  insert into public.wordpress_connector_nonces(connector_id, request_id)
  values (connector_row.id, p_request_id);

  insert into public.wordpress_connector_reports(
    organization_id, website_id, connector_id, request_id, schema_version,
    collected_at, wordpress_version, plugins, spam_comment_count
  ) values (
    connector_row.organization_id, connector_row.website_id, connector_row.id,
    p_request_id, p_schema_version, p_collected_at, p_wordpress_version,
    p_plugins, p_spam_comment_count
  ) returning id into report_id;

  update public.wordpress_connectors
  set last_report_at = now(), last_error_code = null
  where id = connector_row.id and status = 'active';

  return report_id;
end;
$$;
revoke all on function public.save_wordpress_connector_report(uuid, uuid, integer, timestamptz, text, jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.save_wordpress_connector_report(uuid, uuid, integer, timestamptz, text, jsonb, integer)
  to service_role;

alter table public.wordpress_connector_pairing_codes enable row level security;
alter table public.wordpress_connectors enable row level security;
alter table public.wordpress_connector_credentials enable row level security;
alter table public.wordpress_connector_nonces enable row level security;
alter table public.wordpress_connector_rate_windows enable row level security;
alter table public.wordpress_connector_reports enable row level security;

create policy wordpress_connectors_select on public.wordpress_connectors
  for select to authenticated using (public.is_org_member(organization_id));
create policy wordpress_reports_select on public.wordpress_connector_reports
  for select to authenticated using (public.is_org_member(organization_id));
-- No browser writes and no browser access to nonce/replay records.
revoke all on public.wordpress_connector_pairing_codes, public.wordpress_connectors,
  public.wordpress_connector_credentials, public.wordpress_connector_nonces,
  public.wordpress_connector_rate_windows, public.wordpress_connector_reports from anon, authenticated;
grant select on public.wordpress_connectors, public.wordpress_connector_reports to authenticated;

-- Only the server's service role can consume pairing codes, manage connector secrets,
-- record nonce IDs, and write reports. RLS is bypassed only by this server credential.
revoke all on public.wordpress_connector_pairing_codes, public.wordpress_connectors,
  public.wordpress_connector_credentials, public.wordpress_connector_nonces,
  public.wordpress_connector_rate_windows, public.wordpress_connector_reports from public;
grant all on public.wordpress_connector_pairing_codes, public.wordpress_connectors,
  public.wordpress_connector_credentials, public.wordpress_connector_nonces,
  public.wordpress_connector_rate_windows, public.wordpress_connector_reports to service_role;

create or replace function public.consume_wordpress_connector_rate_limit(p_connector_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  rate_row public.wordpress_connector_rate_windows;
begin
  insert into public.wordpress_connector_rate_windows(connector_id, window_started_at, request_count)
  values (p_connector_id, now(), 0)
  on conflict (connector_id) do nothing;

  select * into rate_row from public.wordpress_connector_rate_windows
  where connector_id = p_connector_id for update;

  if rate_row.window_started_at <= now() - interval '1 minute' then
    update public.wordpress_connector_rate_windows
      set window_started_at = now(), request_count = 1 where connector_id = p_connector_id;
    return true;
  end if;
  if rate_row.request_count >= 10 then return false; end if;
  update public.wordpress_connector_rate_windows
    set request_count = request_count + 1 where connector_id = p_connector_id;
  return true;
end;
$$;
revoke all on function public.consume_wordpress_connector_rate_limit(uuid) from public, anon, authenticated;
grant execute on function public.consume_wordpress_connector_rate_limit(uuid) to service_role;
