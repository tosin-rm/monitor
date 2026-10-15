-- Allow authenticated signups to join the existing workspace as Members only.
create or replace function public.join_default_organization()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_email text;
  target_organization_id uuid;
  organization_count integer;
  new_membership_id uuid;
begin
  if actor_id is null then
    raise exception 'An authenticated account is required';
  end if;

  select lower(trim(u.email))
    into actor_email
    from auth.users u
   where u.id = actor_id;

  if actor_email is null then
    raise exception 'Authenticated account email could not be verified';
  end if;

  if exists (
    select 1
      from public.organization_members m
     where m.user_id = actor_id
  ) then
    return true;
  end if;

  perform pg_advisory_xact_lock(731984521);

  if exists (
    select 1
      from public.organization_members m
     where m.user_id = actor_id
  ) then
    return true;
  end if;

  select count(*)
    into organization_count
    from public.organizations;

  if organization_count = 0 then
    return false;
  end if;
  if organization_count <> 1 then
    raise exception 'Automatic signup requires exactly one workspace';
  end if;

  select o.id
    into target_organization_id
    from public.organizations o;

  insert into public.organization_members (
    organization_id, user_id, role, email
  )
  values (
    target_organization_id, actor_id, 'member', actor_email
  )
  on conflict (organization_id, user_id) do nothing
  returning id into new_membership_id;

  if new_membership_id is not null then
    insert into public.audit_logs (
      organization_id, actor_user_id, action, entity_type, entity_id, metadata
    )
    values (
      target_organization_id,
      actor_id,
      'organization.self_signup',
      'organization_member',
      new_membership_id,
      jsonb_build_object('role', 'member')
    );
  end if;

  return true;
end;
$$;

revoke all on function public.join_default_organization() from public, anon, service_role;
grant execute on function public.join_default_organization() to authenticated;

notify pgrst, 'reload schema';
