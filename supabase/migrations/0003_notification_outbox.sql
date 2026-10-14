-- Durable dispatch state, atomic queue claims, and verified channel linking.

alter table public.notifications
  add column retryable boolean not null default true,
  add column delivered_at timestamptz;

create index notifications_dispatch_retryable_idx
  on public.notifications (next_attempt_at, scheduled_at)
  where status in ('queued', 'failed') and retryable = true;

create or replace function public.release_job_lease(
  p_job_name text,
  p_locked_by text
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  released integer;
begin
  update public.job_leases
  set locked_until = null, locked_by = null, updated_at = now()
  where job_name = p_job_name and locked_by = p_locked_by;
  get diagnostics released = row_count;
  return released = 1;
end;
$$;

revoke all on function public.release_job_lease(text, text) from public, anon, authenticated;
grant execute on function public.release_job_lease(text, text) to service_role;

create or replace function public.claim_notifications(p_limit integer default 50)
returns setof public.notifications
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit < 1 or p_limit > 100 then
    raise exception 'Notification claim limit must be between 1 and 100';
  end if;

  -- A crash or timeout after a provider request is ambiguous. Do not resend
  -- such messages automatically; make them visible for operator review.
  update public.notifications
  set status = 'failed',
      retryable = false,
      sanitized_error = 'Delivery outcome unknown; review provider before retrying'
  where status = 'sending'
    and last_attempt_at < now() - interval '10 minutes';

  return query
  with due as (
    select id
    from public.notifications
    where status in ('queued', 'failed')
      and retryable = true
      and attempts < max_attempts
      and scheduled_at <= now()
      and next_attempt_at <= now()
    order by next_attempt_at, scheduled_at, created_at
    for update skip locked
    limit p_limit
  )
  update public.notifications n
  set status = 'sending',
      attempts = n.attempts + 1,
      last_attempt_at = now(),
      retryable = true
  from due
  where n.id = due.id
  returning n.*;
end;
$$;

revoke all on function public.claim_notifications(integer) from public, anon, authenticated;
grant execute on function public.claim_notifications(integer) to service_role;

create or replace function public.retry_notification(
  p_notification_id uuid,
  p_organization_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  notification_row public.notifications;
begin
  if auth.uid() is null or not public.has_min_role(p_organization_id, 'admin') then
    raise exception 'Notification retry is not authorized';
  end if;

  select * into notification_row
  from public.notifications
  where id = p_notification_id
    and organization_id = p_organization_id
  for update;

  if not found
    or notification_row.status <> 'failed'
    or not notification_row.retryable
    or notification_row.attempts >= notification_row.max_attempts then
    raise exception 'Notification is not eligible for retry';
  end if;

  update public.notifications
  set status = 'queued',
      next_attempt_at = now(),
      sanitized_error = null
  where id = p_notification_id;

  insert into public.audit_logs (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  )
  values (
    p_organization_id,
    auth.uid(),
    'notification.retry_requested',
    'notification',
    p_notification_id,
    jsonb_build_object('channel', notification_row.channel)
  );
end;
$$;

revoke all on function public.retry_notification(uuid, uuid) from public, anon;
grant execute on function public.retry_notification(uuid, uuid) to authenticated;

create or replace function public.consume_telegram_link_challenge(
  p_code_hash text,
  p_chat_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  challenge public.telegram_link_challenges;
begin
  if p_chat_id !~ '^-?[0-9]{1,32}$' then
    raise exception 'Telegram chat reference is invalid';
  end if;

  select * into challenge
  from public.telegram_link_challenges
  where code_hash = p_code_hash
    and consumed_at is null
    and expires_at > now()
  for update;

  if not found then
    raise exception 'Telegram link code is invalid or expired';
  end if;

  update public.telegram_link_challenges
  set consumed_at = now()
  where id = challenge.id;

  update public.notification_settings
  set telegram_chat_ids = array(
    select distinct candidate.chat_id
    from unnest(array_append(telegram_chat_ids, p_chat_id)) as candidate(chat_id)
    order by candidate.chat_id
  )
  where organization_id = challenge.organization_id;

  if not found then
    raise exception 'Notification settings are unavailable';
  end if;

  insert into public.audit_logs (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  )
  values (
    challenge.organization_id,
    challenge.created_by,
    'notification.telegram_chat_linked',
    'notification_settings',
    challenge.organization_id,
    '{}'::jsonb
  );

  return challenge.organization_id;
end;
$$;

revoke all on function public.consume_telegram_link_challenge(text, text)
  from public, anon, authenticated;
grant execute on function public.consume_telegram_link_challenge(text, text)
  to service_role;

create or replace function public.remove_telegram_chat(
  p_organization_id uuid,
  p_chat_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_chat_ids text[];
begin
  if auth.uid() is null or not public.has_min_role(p_organization_id, 'admin') then
    raise exception 'Telegram chat management is not authorized';
  end if;

  select telegram_chat_ids into current_chat_ids
  from public.notification_settings
  where organization_id = p_organization_id
  for update;

  if not found or not (p_chat_id = any(current_chat_ids)) then
    raise exception 'Telegram chat is not linked to this organization';
  end if;

  update public.notification_settings
  set telegram_chat_ids = array(
    select linked.chat_id
    from unnest(current_chat_ids) as linked(chat_id)
    where linked.chat_id <> p_chat_id
  )
  where organization_id = p_organization_id;

  insert into public.audit_logs (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  )
  values (
    p_organization_id,
    auth.uid(),
    'notification.telegram_chat_unlinked',
    'notification_settings',
    p_organization_id,
    '{}'::jsonb
  );
end;
$$;

revoke all on function public.remove_telegram_chat(uuid, text) from public, anon;
grant execute on function public.remove_telegram_chat(uuid, text) to authenticated;

revoke update on public.notification_settings from authenticated;
grant select on public.notification_settings to authenticated;
grant update (
  email_enabled,
  telegram_enabled,
  whatsapp_enabled,
  email_recipients,
  reminder_intervals,
  incident_failure_threshold,
  escalate_after_minutes,
  quiet_hours_enabled,
  quiet_hours_start,
  quiet_hours_end
) on public.notification_settings to authenticated;

create trigger notification_settings_audit
after insert or update on public.notification_settings
for each row execute function public.audit_operational_change();
