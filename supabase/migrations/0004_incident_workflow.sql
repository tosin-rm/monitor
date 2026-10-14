revoke update on public.incidents from authenticated;

create or replace function public.set_incident_status(
  p_incident_id uuid,
  p_status public.incident_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  incident_row public.incidents;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;
  if p_status not in ('acknowledged', 'investigating', 'resolved') then
    raise exception 'Incident status transition is not permitted';
  end if;

  select * into incident_row
  from public.incidents
  where id = p_incident_id
  for update;
  if not found or not public.is_org_member(incident_row.organization_id) then
    raise exception 'Incident is not available to this member';
  end if;
  if incident_row.status in ('resolved', 'suppressed') then
    raise exception 'Incident is already closed';
  end if;
  if p_status = 'resolved'
    and not public.has_min_role(incident_row.organization_id, 'admin') then
    raise exception 'Only administrators can resolve incidents';
  end if;
  if incident_row.status = p_status then
    return;
  end if;

  update public.incidents
  set status = p_status,
      resolved_at = case when p_status = 'resolved' then now() else null end
  where id = p_incident_id;

  insert into public.audit_logs (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  )
  values (
    incident_row.organization_id,
    auth.uid(),
    'incident.status_changed',
    'incident',
    p_incident_id,
    jsonb_build_object('from', incident_row.status, 'to', p_status)
  );
end;
$$;

revoke all on function public.set_incident_status(uuid, public.incident_status)
  from public, anon;
grant execute on function public.set_incident_status(uuid, public.incident_status)
  to authenticated;
