alter table public.clients
  add column lifecycle_status text not null default 'active'
  check (lifecycle_status in ('active', 'on_hold', 'transferred', 'archived'));

update public.clients
set lifecycle_status = 'archived'
where active = false;

alter table public.clients
  add constraint clients_lifecycle_active_consistency
  check (active = (lifecycle_status = 'active'));

alter table public.websites
  add column lifecycle_status text not null default 'active'
  check (lifecycle_status in ('active', 'on_hold', 'transferred', 'archived'));

update public.websites
set lifecycle_status = 'archived'
where active = false;

alter table public.websites
  add constraint websites_lifecycle_active_consistency
  check (active = (lifecycle_status = 'active'));

-- Keep child monitoring preferences intact so a temporary status can be resumed.
drop trigger clients_archive_services on public.clients;
drop trigger websites_archive_services on public.websites;

create index clients_org_lifecycle_idx
  on public.clients (organization_id, lifecycle_status);

create index websites_org_lifecycle_idx
  on public.websites (organization_id, lifecycle_status);

create or replace function public.audit_operational_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_data jsonb;
  action_name text;
  new_status text;
begin
  row_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  new_status := to_jsonb(new) ->> 'lifecycle_status';
  action_name := lower(tg_table_name) || case
    when tg_op = 'INSERT' then '.created'
    when tg_op = 'DELETE' then '.deleted'
    when tg_table_name in ('clients', 'websites')
      and to_jsonb(old) ->> 'lifecycle_status' is distinct from new_status then '.' || new_status
    when tg_table_name = 'clients'
      and to_jsonb(old) ->> 'active' = 'true'
      and to_jsonb(new) ->> 'active' = 'false' then '.archived'
    else '.updated'
  end;

  insert into public.audit_logs (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  )
  values (
    (row_data ->> 'organization_id')::uuid,
    auth.uid(),
    action_name,
    tg_table_name,
    (row_data ->> 'id')::uuid,
    '{}'::jsonb
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.get_active_wordpress_plugin_slugs()
returns text[]
language sql
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct item.plugin ->> 'slug'), array[]::text[])
  from public.wordpress_connectors c
  join public.websites w on w.id = c.website_id
    and w.organization_id = c.organization_id and w.active = true and w.platform = 'wordpress'
  join public.clients cl on cl.id = w.client_id
    and cl.organization_id = w.organization_id and cl.active = true
  cross join lateral (
    select r.plugins from public.wordpress_connector_reports r
    where r.connector_id = c.id order by r.received_at desc limit 1
  ) latest
  cross join lateral jsonb_array_elements(latest.plugins) as item(plugin)
  where c.status = 'active'
$$;
