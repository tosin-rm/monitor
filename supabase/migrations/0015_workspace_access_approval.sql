create table public.workspace_access_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index workspace_access_requests_pending_idx
  on public.workspace_access_requests (organization_id, created_at)
  where status = 'pending';

create trigger workspace_access_requests_set_updated_at
before update on public.workspace_access_requests
for each row execute procedure public.set_updated_at();

alter table public.workspace_access_requests enable row level security;

create policy workspace_access_requests_admin_select
  on public.workspace_access_requests
  for select to authenticated
  using (public.has_min_role(organization_id, 'admin'));

create policy workspace_access_requests_insert_deny
  on public.workspace_access_requests
  for insert to authenticated
  with check (false);

create policy workspace_access_requests_update_deny
  on public.workspace_access_requests
  for update to authenticated
  using (false);

create policy workspace_access_requests_delete_deny
  on public.workspace_access_requests
  for delete to authenticated
  using (false);

grant select on public.workspace_access_requests to authenticated;
grant all on public.workspace_access_requests to service_role;

create or replace function public.submit_workspace_access_request()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_email text;
  target_organization_id uuid;
  organization_count integer;
  previous_status text;
  request_status text;
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
    return 'approved';
  end if;

  perform pg_advisory_xact_lock(731984521);

  select count(*)
    into organization_count
    from public.organizations;

  if organization_count <> 1 then
    raise exception 'Access requests require exactly one workspace';
  end if;

  select o.id
    into target_organization_id
    from public.organizations o;

  select r.status
    into previous_status
    from public.workspace_access_requests r
   where r.organization_id = target_organization_id
     and r.user_id = actor_id
   for update;

  insert into public.workspace_access_requests (
    organization_id, user_id, email, status, reviewed_by, reviewed_at
  )
  values (
    target_organization_id, actor_id, actor_email, 'pending', null, null
  )
  on conflict (organization_id, user_id)
  do update set
    email = excluded.email,
    status = case
      when public.workspace_access_requests.status = 'rejected' then 'pending'
      else public.workspace_access_requests.status
    end,
    reviewed_by = case
      when public.workspace_access_requests.status = 'rejected' then null
      else public.workspace_access_requests.reviewed_by
    end,
    reviewed_at = case
      when public.workspace_access_requests.status = 'rejected' then null
      else public.workspace_access_requests.reviewed_at
    end
  returning status into request_status;

  if previous_status is null or previous_status = 'rejected' then
    insert into public.audit_logs (
      organization_id, actor_user_id, action, entity_type, entity_id, metadata
    )
    values (
      target_organization_id,
      actor_id,
      'workspace.access_requested',
      'workspace_access_request',
      actor_id,
      jsonb_build_object('email', actor_email)
    );
  end if;

  return request_status;
end;
$$;

revoke all on function public.submit_workspace_access_request() from public, anon, service_role;
grant execute on function public.submit_workspace_access_request() to authenticated;

create or replace function public.review_workspace_access_request(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_approve boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role public.member_role;
  access_request public.workspace_access_requests%rowtype;
begin
  select m.role
    into actor_role
    from public.organization_members m
   where m.organization_id = p_organization_id
     and m.user_id = p_actor_user_id;

  if actor_role is null or actor_role not in ('owner', 'admin') then
    raise exception 'Only an organization administrator can review access requests';
  end if;

  select r.*
    into access_request
    from public.workspace_access_requests r
   where r.id = p_request_id
     and r.organization_id = p_organization_id
   for update;

  if access_request.id is null or access_request.status <> 'pending' then
    raise exception 'A pending access request could not be found';
  end if;

  if p_approve then
    insert into public.organization_members (
      organization_id, user_id, role, email
    )
    values (
      p_organization_id, access_request.user_id, 'member', access_request.email
    )
    on conflict (organization_id, user_id) do nothing;
  end if;

  update public.workspace_access_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         reviewed_by = p_actor_user_id,
         reviewed_at = now()
   where id = access_request.id;

  insert into public.audit_logs (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  )
  values (
    p_organization_id,
    p_actor_user_id,
    case when p_approve then 'workspace.access_approved' else 'workspace.access_rejected' end,
    'workspace_access_request',
    access_request.user_id,
    jsonb_build_object('email', access_request.email, 'role', 'member')
  );
end;
$$;

revoke all on function public.review_workspace_access_request(uuid, uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.review_workspace_access_request(uuid, uuid, uuid, boolean)
  to service_role;

create or replace function public.join_default_organization()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'An authenticated account is required';
  end if;

  return exists (
    select 1
      from public.organization_members m
     where m.user_id = auth.uid()
  );
end;
$$;

revoke all on function public.join_default_organization() from public, anon, service_role;
grant execute on function public.join_default_organization() to authenticated;

notify pgrst, 'reload schema';
