create or replace function public.audit_operational_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_data jsonb;
  action_name text;
begin
  row_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  action_name := lower(tg_table_name) || case
    when tg_op = 'INSERT' then '.created'
    when tg_op = 'DELETE' then '.deleted'
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
