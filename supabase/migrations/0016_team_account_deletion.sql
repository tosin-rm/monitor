alter table public.wordpress_connector_pairing_codes
  alter column created_by drop not null;

alter table public.wordpress_connector_pairing_codes
  drop constraint wordpress_connector_pairing_codes_created_by_fkey,
  add constraint wordpress_connector_pairing_codes_created_by_fkey
    foreign key (created_by) references auth.users (id) on delete set null;

create or replace function public.prepare_team_member_account_deletion(
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
  target_email text;
begin
  select m.role
    into actor_role
    from public.organization_members m
   where m.organization_id = p_organization_id
     and m.user_id = p_actor_user_id;

  if actor_role is null or actor_role not in ('owner', 'admin') then
    raise exception 'Only an organization administrator can delete a team account';
  end if;
  if p_actor_user_id = p_target_user_id then
    raise exception 'Administrators cannot delete their own account';
  end if;

  select m.role, m.email
    into target_role, target_email
    from public.organization_members m
   where m.organization_id = p_organization_id
     and m.user_id = p_target_user_id
   for update;

  if target_role is null then
    raise exception 'Team member was not found';
  end if;
  if target_role = 'owner' and actor_role <> 'owner' then
    raise exception 'Only an owner can delete another owner account';
  end if;

  update public.invitations
     set revoked_at = now()
   where organization_id = p_organization_id
     and supabase_user_id = p_target_user_id
     and accepted_at is null
     and revoked_at is null;

  insert into public.audit_logs (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  )
  values (
    p_organization_id,
    p_actor_user_id,
    'team.member_account_deleted',
    'organization_member',
    p_target_user_id,
    jsonb_build_object('email', target_email, 'previous_role', target_role)
  );

  delete from public.organization_members
   where organization_id = p_organization_id
     and user_id = p_target_user_id;
end;
$$;

revoke all on function public.prepare_team_member_account_deletion(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.prepare_team_member_account_deletion(uuid, uuid, uuid)
  to service_role;

create or replace function public.prepare_pending_invitation_account_deletion(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_invitation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role public.member_role;
  invitation public.invitations%rowtype;
  target_role public.member_role;
begin
  select m.role
    into actor_role
    from public.organization_members m
   where m.organization_id = p_organization_id
     and m.user_id = p_actor_user_id;

  if actor_role is null or actor_role not in ('owner', 'admin') then
    raise exception 'Only an organization administrator can cancel invitations';
  end if;

  select i.*
    into invitation
    from public.invitations i
   where i.id = p_invitation_id
     and i.organization_id = p_organization_id
     and i.accepted_at is null
     and i.revoked_at is null
   for update;

  if invitation.id is null then
    raise exception 'A pending invitation could not be found';
  end if;

  if invitation.supabase_user_id = p_actor_user_id then
    raise exception 'Administrators cannot delete their own account';
  end if;

  if invitation.supabase_user_id is not null then
    select m.role
      into target_role
      from public.organization_members m
     where m.organization_id = p_organization_id
       and m.user_id = invitation.supabase_user_id
     for update;

    if target_role = 'owner' and actor_role <> 'owner' then
      raise exception 'Only an owner can delete another owner account';
    end if;
  end if;

  update public.invitations
     set revoked_at = now()
   where id = invitation.id;

  if invitation.supabase_user_id is not null then
    insert into public.audit_logs (
      organization_id, actor_user_id, action, entity_type, entity_id, metadata
    )
    values (
      p_organization_id,
      p_actor_user_id,
      'team.pending_invitation_account_deleted',
      'invitation',
      invitation.id,
      jsonb_build_object('email', invitation.email, 'role', invitation.role)
    );

    delete from public.organization_members
     where organization_id = p_organization_id
       and user_id = invitation.supabase_user_id;
  else
    insert into public.audit_logs (
      organization_id, actor_user_id, action, entity_type, entity_id, metadata
    )
    values (
      p_organization_id,
      p_actor_user_id,
      'team.invitation_revoked',
      'invitation',
      invitation.id,
      jsonb_build_object('email', invitation.email)
    );
  end if;

  return invitation.supabase_user_id;
end;
$$;

revoke all on function public.prepare_pending_invitation_account_deletion(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.prepare_pending_invitation_account_deletion(uuid, uuid, uuid)
  to service_role;

create or replace function public.accept_team_invitation()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  invitation public.invitations%rowtype;
begin
  if actor_id is null then
    raise exception 'An authenticated account is required';
  end if;

  select i.*
    into invitation
    from public.invitations i
   where i.supabase_user_id = actor_id
     and i.accepted_at is null
     and i.revoked_at is null
     and i.expires_at > now()
     and exists (
       select 1
         from public.organization_members m
        where m.organization_id = i.organization_id
          and m.user_id = actor_id
     )
   order by i.created_at desc
   limit 1
   for update;

  if invitation.id is null then
    return false;
  end if;

  update public.invitations i
     set accepted_at = now()
   where i.id = invitation.id
   returning i.* into invitation;

  insert into public.audit_logs (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  )
  values (
    invitation.organization_id,
    actor_id,
    'team.invitation_accepted',
    'invitation',
    invitation.id,
    jsonb_build_object('email', invitation.email, 'role', invitation.role)
  );

  return true;
end;
$$;

revoke all on function public.accept_team_invitation() from public, anon, service_role;
grant execute on function public.accept_team_invitation() to authenticated;

notify pgrst, 'reload schema';
