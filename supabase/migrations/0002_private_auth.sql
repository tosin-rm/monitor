-- Private first-owner bootstrap and audited team administration.

-- Serialize owner demotion/removal so concurrent administrator requests cannot
-- remove the final owner.
create or replace function public.organization_members_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_count integer;
  affected_organization_id uuid;
begin
  affected_organization_id := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;

  if (tg_op = 'DELETE' and old.role = 'owner')
    or (tg_op = 'UPDATE' and old.role = 'owner' and new.role <> 'owner') then
    perform pg_advisory_xact_lock(hashtextextended(affected_organization_id::text, 1));
    select count(*) into owner_count
    from public.organization_members
    where organization_id = affected_organization_id
      and role = 'owner'
      and id <> old.id;

    if owner_count < 1 then
      raise exception 'Cannot remove or demote the last owner';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop policy assets_update on public.assets;
create policy assets_update on public.assets
  for update to authenticated
  using (public.has_min_role(organization_id, 'admin'))
  with check (public.has_min_role(organization_id, 'admin'));

drop policy renewal_history_insert on public.renewal_history;
create policy renewal_history_insert_deny on public.renewal_history
  for insert to authenticated
  with check (false);
revoke insert on public.renewal_history from authenticated;

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

create trigger clients_audit
after insert or update on public.clients
for each row execute function public.audit_operational_change();
create trigger websites_audit
after insert or update on public.websites
for each row execute function public.audit_operational_change();
create trigger assets_audit
after insert or update on public.assets
for each row execute function public.audit_operational_change();
create trigger monitoring_endpoints_audit
after insert or update on public.monitoring_endpoints
for each row execute function public.audit_operational_change();

create or replace function public.deactivate_archived_client_services()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.active and not new.active then
    update public.websites
      set active = false
      where client_id = new.id and organization_id = new.organization_id;
    update public.assets
      set active = false
      where organization_id = new.organization_id
        and website_id in (select id from public.websites where client_id = new.id);
    update public.monitoring_endpoints
      set enabled = false
      where organization_id = new.organization_id
        and website_id in (select id from public.websites where client_id = new.id);
  end if;
  return new;
end;
$$;

create trigger clients_archive_services
after update of active on public.clients
for each row execute function public.deactivate_archived_client_services();

create or replace function public.deactivate_archived_website_services()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.active and not new.active then
    update public.assets set active = false
    where website_id = new.id and organization_id = new.organization_id;
    update public.monitoring_endpoints set enabled = false
    where website_id = new.id and organization_id = new.organization_id;
  end if;
  return new;
end;
$$;

create trigger websites_archive_services
after update of active on public.websites
for each row execute function public.deactivate_archived_website_services();

create or replace function public.confirm_asset_renewal(
  p_asset_id uuid,
  p_new_expiry_date date,
  p_confirmation_method public.confirmation_method,
  p_confirmation_notes text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  asset_organization_id uuid;
  old_expiry_date date;
begin
  if auth.uid() is null then
    raise exception 'An authenticated team member is required';
  end if;

  select organization_id, expiry_date
    into asset_organization_id, old_expiry_date
    from public.assets
    where id = p_asset_id
    for update;

  if not found or not public.is_org_member(asset_organization_id) then
    raise exception 'Asset was not found in an accessible organization';
  end if;
  if not public.has_min_role(asset_organization_id, 'member') then
    raise exception 'Renewal confirmation is not authorized';
  end if;

  update public.assets
  set expiry_date = p_new_expiry_date,
      renewal_status = 'renewed',
      date_source = p_confirmation_method::text::public.date_source,
      date_confidence = 'high',
      manual_override = p_confirmation_method = 'manual',
      last_verified_at = now(),
      last_check_error = null
  where id = p_asset_id;

  insert into public.renewal_history (
    organization_id, asset_id, previous_expiry_date, new_expiry_date,
    confirmation_method, confirmed_by, confirmation_notes
  )
  values (
    asset_organization_id, p_asset_id, old_expiry_date, p_new_expiry_date,
    p_confirmation_method, auth.uid(), left(p_confirmation_notes, 1000)
  );

  insert into public.audit_logs (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  )
  values (
    asset_organization_id, auth.uid(), 'asset.renewal_confirmed', 'asset', p_asset_id,
    jsonb_build_object('previous_expiry_date', old_expiry_date, 'new_expiry_date', p_new_expiry_date)
  );
end;
$$;

revoke all on function public.confirm_asset_renewal(uuid, date, public.confirmation_method, text)
  from public, anon;
grant execute on function public.confirm_asset_renewal(uuid, date, public.confirmation_method, text)
  to authenticated;

drop policy job_runs_select on public.job_runs;
create policy job_runs_select on public.job_runs
  for select to authenticated
  using (
    organization_id is not null
    and public.has_min_role(organization_id, 'admin')
  );

revoke all on function public.try_acquire_job_lease(text, text, integer)
  from public, anon, authenticated;
grant execute on function public.try_acquire_job_lease(text, text, integer)
  to service_role;

create or replace function public.bootstrap_first_owner(
  p_name text,
  p_timezone text,
  p_user_id uuid,
  p_email text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_organization_id uuid;
begin
  perform pg_advisory_xact_lock(731984521);

  if exists (select 1 from public.organizations) then
    raise exception 'Initial organization has already been created';
  end if;

  if not exists (
    select 1
    from auth.users u
    where u.id = p_user_id
      and lower(u.email) = lower(trim(p_email))
  ) then
    raise exception 'Bootstrap user identity could not be verified';
  end if;

  if char_length(trim(p_name)) not between 1 and 120 then
    raise exception 'Organization name is invalid';
  end if;

  insert into public.organizations (name, timezone)
  values (trim(p_name), trim(p_timezone))
  returning id into new_organization_id;

  insert into public.organization_members (organization_id, user_id, role, email)
  values (new_organization_id, p_user_id, 'owner', lower(trim(p_email)));

  insert into public.notification_settings (organization_id)
  values (new_organization_id);

  insert into public.audit_logs (
    organization_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    new_organization_id,
    p_user_id,
    'organization.bootstrap',
    'organization',
    new_organization_id,
    jsonb_build_object('owner_email', lower(trim(p_email)))
  );

  return new_organization_id;
end;
$$;

revoke all on function public.bootstrap_first_owner(text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.bootstrap_first_owner(text, text, uuid, text) to service_role;

create or replace function public.record_team_invitation(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_user_id uuid,
  p_email text,
  p_role public.member_role,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation_id uuid;
  actor_role public.member_role;
begin
  select role into actor_role
  from public.organization_members
  where organization_id = p_organization_id and user_id = p_actor_user_id;

  if actor_role is null or actor_role not in ('owner', 'admin') then
    raise exception 'Only an organization administrator can invite members';
  end if;
  if p_role = 'owner' or (p_role = 'admin' and actor_role <> 'owner') then
    raise exception 'The requested role cannot be assigned by this administrator';
  end if;
  if not exists (
    select 1 from auth.users u
    where u.id = p_user_id and lower(u.email) = lower(trim(p_email))
  ) then
    raise exception 'Invited user identity could not be verified';
  end if;
  if exists (
    select 1 from public.organization_members m
    where m.organization_id = p_organization_id and m.user_id = p_user_id
  ) then
    raise exception 'User is already a member of this organization';
  end if;

  insert into public.invitations (
    organization_id, email, role, invited_by, supabase_user_id, expires_at
  )
  values (
    p_organization_id, lower(trim(p_email)), p_role, p_actor_user_id, p_user_id, p_expires_at
  )
  returning id into invitation_id;

  insert into public.organization_members (organization_id, user_id, role, email, invited_by)
  values (p_organization_id, p_user_id, p_role, lower(trim(p_email)), p_actor_user_id);

  insert into public.audit_logs (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  )
  values (
    p_organization_id,
    p_actor_user_id,
    'team.member_invited',
    'organization_member',
    p_user_id,
    jsonb_build_object('email', lower(trim(p_email)), 'role', p_role)
  );

  return invitation_id;
end;
$$;

revoke all on function public.record_team_invitation(uuid, uuid, uuid, text, public.member_role, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_team_invitation(uuid, uuid, uuid, text, public.member_role, timestamptz)
  to service_role;

create or replace function public.change_team_member_role(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_role public.member_role
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role public.member_role;
  target_role public.member_role;
begin
  select role into actor_role
  from public.organization_members
  where organization_id = p_organization_id and user_id = p_actor_user_id;
  select role into target_role
  from public.organization_members
  where organization_id = p_organization_id and user_id = p_target_user_id
  for update;

  if actor_role is null or actor_role not in ('owner', 'admin') or target_role is null then
    raise exception 'Team member role change is not authorized';
  end if;
  if p_actor_user_id = p_target_user_id then
    raise exception 'Administrators cannot change their own role';
  end if;
  if (target_role = 'owner' or p_role = 'owner') and actor_role <> 'owner' then
    raise exception 'Only an owner can change owner privileges';
  end if;
  if p_role = 'owner' and actor_role <> 'owner' then
    raise exception 'Only an owner can assign owner privileges';
  end if;

  update public.organization_members
  set role = p_role
  where organization_id = p_organization_id and user_id = p_target_user_id;

  insert into public.audit_logs (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  )
  values (
    p_organization_id,
    p_actor_user_id,
    'team.member_role_changed',
    'organization_member',
    p_target_user_id,
    jsonb_build_object('previous_role', target_role, 'new_role', p_role)
  );
end;
$$;

revoke all on function public.change_team_member_role(uuid, uuid, uuid, public.member_role)
  from public, anon, authenticated;
grant execute on function public.change_team_member_role(uuid, uuid, uuid, public.member_role)
  to service_role;

create or replace function public.remove_team_member(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_target_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role public.member_role;
  target_role public.member_role;
begin
  select role into actor_role
  from public.organization_members
  where organization_id = p_organization_id and user_id = p_actor_user_id;
  select role into target_role
  from public.organization_members
  where organization_id = p_organization_id and user_id = p_target_user_id
  for update;

  if actor_role is null or actor_role not in ('owner', 'admin') or target_role is null then
    raise exception 'Team member removal is not authorized';
  end if;
  if p_actor_user_id = p_target_user_id then
    raise exception 'Administrators cannot remove themselves';
  end if;
  if target_role = 'owner' and actor_role <> 'owner' then
    raise exception 'Only an owner can remove another owner';
  end if;

  insert into public.audit_logs (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  )
  values (
    p_organization_id,
    p_actor_user_id,
    'team.member_removed',
    'organization_member',
    p_target_user_id,
    jsonb_build_object('previous_role', target_role)
  );

  delete from public.organization_members
  where organization_id = p_organization_id and user_id = p_target_user_id;
end;
$$;

revoke all on function public.remove_team_member(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.remove_team_member(uuid, uuid, uuid) to service_role;
