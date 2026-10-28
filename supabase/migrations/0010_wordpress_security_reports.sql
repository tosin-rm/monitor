-- Optional, normalized security results reported alongside connector inventory.
-- Security data shares the existing report's connection, retention and RLS boundary.
alter table public.wordpress_connector_reports
  add column security_report jsonb not null default '{}'::jsonb;

create or replace function public.save_wordpress_connector_report_v2(
  p_connector_id uuid,
  p_request_id uuid,
  p_schema_version integer,
  p_collected_at timestamptz,
  p_wordpress_version text,
  p_plugins jsonb,
  p_spam_comment_count integer,
  p_security_report jsonb
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
    collected_at, wordpress_version, plugins, spam_comment_count, security_report
  ) values (
    connector_row.organization_id, connector_row.website_id, connector_row.id,
    p_request_id, p_schema_version, p_collected_at, p_wordpress_version,
    p_plugins, p_spam_comment_count, coalesce(p_security_report, '{}'::jsonb)
  ) returning id into report_id;

  update public.wordpress_connectors
  set last_report_at = now(), last_error_code = null
  where id = connector_row.id and status = 'active';

  return report_id;
end;
$$;
revoke all on function public.save_wordpress_connector_report_v2(uuid, uuid, integer, timestamptz, text, jsonb, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_wordpress_connector_report_v2(uuid, uuid, integer, timestamptz, text, jsonb, integer, jsonb)
  to service_role;
