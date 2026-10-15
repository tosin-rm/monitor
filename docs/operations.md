# Deployment and operations

For everyday workflows and role-specific instructions, see the [developer, team, and client guide](./guide.md).

## Current implementation boundary

The application includes private Supabase Auth, organization-scoped RLS, client/site/service inventory, manual renewals, a durable notification outbox, Resend/Telegram adapters, expiry reminder evaluation, RDAP parsing/provider helpers, TLS inspection, SSRF-safe HTTP checks, and an independently runnable worker for uptime and certificate checks.

No external Supabase project or database has been connected in this workspace. The migrations, Auth flows, provider delivery, Cron schedules, and RLS behavior therefore still require deployment verification. RDAP refresh is not yet run by a scheduled worker; WhatsApp delivery, provider-specific hosting APIs, and independent worker-health alerting are not enabled.

## Local development

1. Install the pinned dependencies with `npm ci`.
2. Copy `.env.example` to `.env.local` and replace placeholders locally. Never commit `.env.local`.
3. Set the Supabase URL and publishable key for the development project. Keep the secret/service-role key server-side.
4. Run `npm run dev`. Use a dedicated non-production Supabase project; do not point experiments at production data.
5. Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` before deployment.
6. Run `npm run worker:uptime` in a separate terminal after configuring the server-only Supabase secret and worker variables.

The worker reads environment variables supplied by its process manager. In production, use the platform's secret store rather than a checked-in env file.

## Supabase project and migrations

1. Create a Supabase project and configure its database region and backups. Keep **Allow new users to sign up** disabled until the initial workspace and Owner are ready.
2. Add the production dashboard URL to the Auth redirect/site URL configuration. Set `APP_BASE_URL` to the dashboard origin (for example `https://monitor.example.com`, not a `/login` URL), allow `/auth/callback`, and configure Supabase confirmation and invite emails to return through the callback. Use the invite `token_hash` template documented in [the user guide](./guide.md).
3. Review the SQL migrations in `supabase/migrations/` in order. Apply them to a new project using the Supabase CLI migration workflow or SQL editor after reviewing the target project. Do not run a destructive reset against a database with existing data. Migration `0005_open_signup_membership.sql` must be applied before enabling public signup.
4. Confirm each migration completes, inspect the RLS policies/functions, and execute the cross-organization access tests in a dedicated database test project.
5. Create the initial Auth user for the email configured as `BOOTSTRAP_OWNER_EMAIL`: use **Authentication → Users → Invite user**, or **Add user → Create new user** if invitation email is rate-limited. The configured Owner signs in and completes the guarded `/setup` bootstrap. Bootstrap is atomic and succeeds only while the database has no organization. For direct creation, provide any temporary password securely and have the Owner replace it at `/set-password`.
6. Verify the organization exists and the Owner can access the dashboard. Then enable **Allow new users to sign up** in Supabase Auth and deploy the app containing the public `/signup` page.
7. Team members create accounts at `/signup` and confirm their email. The database attaches each new account to the single existing workspace as a `member`; it never accepts a role or organization from the signup form. Owners/Admins continue to be assigned only through trusted administration. Verify these flows and permissions with separate test accounts.

Do not treat successful local TypeScript tests as evidence that migrations or RLS have been applied. This checkout has no connected database test environment.

## Environment variables

Configure only the values required by the deployed surface:

| Variable | Surface | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Dashboard and worker | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Dashboard | Browser-safe Supabase publishable key |
| `SUPABASE_SECRET_KEY` | Server and worker only | Privileged database operations; never expose to browser code |
| `APP_BASE_URL` | Dashboard | Absolute dashboard base URL in notification links |
| `BOOTSTRAP_OWNER_EMAIL` | Dashboard, initial setup only | Email allowed to perform first-owner bootstrap |
| `RESEND_API_KEY` | Dashboard | Resend API credential |
| `EMAIL_FROM` | Dashboard | Verified Resend sender |
| `RESEND_WEBHOOK_SECRET` | Dashboard | Resend webhook signing secret |
| `TELEGRAM_BOT_TOKEN` | Dashboard | Bot API token; server-side only |
| `TELEGRAM_WEBHOOK_SECRET` | Dashboard | Secret Telegram webhook path token |
| `MONITORING_JOB_SECRET` | Dashboard / Edge Function | Authenticates scheduled job calls to the dashboard |
| `MONITOR_FUNCTION_SECRET` | Edge Function / Vault | Authenticates the Supabase Edge Function trigger |
| `DASHBOARD_BASE_URL` | Edge Function | HTTPS dashboard origin forwarded to by the function |
| `WORKER_ID` | Worker | Unique stable worker instance label |
| `WORKER_CONCURRENCY` | Worker | Number of simultaneous endpoint probes (1–20; default 5) |
| `WORKER_POLL_INTERVAL_SECONDS` | Worker | Poll cadence (5–3600 seconds; default 30) |
| `SSL_CHECK_INTERVAL_SECONDS` | Worker | Certificate-check cadence (3600–86400 seconds; default 21600) |

Keep all secrets in the hosting platform's environment/secret manager. Rotate the Supabase secret key, Resend key, Telegram token, job secrets, and webhook secrets independently; after rotation, update the dashboard, worker, Edge Function, Vault, and webhook configuration as applicable. Never write secret values into logs, audit metadata, screenshots, or support tickets.

## Resend email

1. Verify the sending domain in Resend and publish the required DNS records.
2. Set `RESEND_API_KEY` and a verified `EMAIL_FROM`.
3. Configure the Resend webhook to `https://<dashboard-host>/api/webhooks/resend` and copy its signing secret to `RESEND_WEBHOOK_SECRET`.
4. Subscribe to delivery, bounce, failure, suppression, delay, and complaint events supported by the account.
5. Configure verified recipients in Notification settings and queue an email test. Check both provider acceptance in the UI and subsequent delivery webhook status. An accepted API request alone is not proof of delivery.

Automated tests use no real email account or provider request.

## Telegram

1. Create a bot with Telegram's official BotFather and set `TELEGRAM_BOT_TOKEN` only in the dashboard's server environment.
2. Set a long random `TELEGRAM_WEBHOOK_SECRET`. Configure the bot webhook at `https://<dashboard-host>/api/webhooks/telegram/<secret>` using Telegram's `setWebhook` API and configure Telegram's `secret_token` to the same value.
3. In Notification settings, an administrator creates a short-lived linking code. The recipient must start the bot and send `/start <code>`; only then can the bot deliver private messages. For groups, add the bot and use the same authorization flow from the approved group.
4. Enable Telegram notifications and queue a test message. Remove old or unauthorized chats from settings.
5. Treat the bot token and webhook secret as credentials. Rotate them by updating the host and Telegram webhook configuration together.

Telegram delivery has not been verified against a configured bot in this environment.

## Supabase scheduled notifications

The expiry evaluator and outbox dispatcher are authenticated Next.js routes. A Supabase Edge Function at `supabase/functions/monitor-jobs/` validates a separate `MONITOR_FUNCTION_SECRET`, then forwards only the supported `expiry` and `notifications` job names using `MONITORING_JOB_SECRET`.

1. Deploy the dashboard over HTTPS and configure `MONITORING_JOB_SECRET`.
2. Deploy the `monitor-jobs` Edge Function. Configure its server-side `DASHBOARD_BASE_URL`, `MONITOR_FUNCTION_SECRET`, and `MONITORING_JOB_SECRET`. Its custom secret check is required because `verify_jwt = false` is set for this function.
3. Enable the `pg_cron`, `pg_net`, and Vault extensions in the Supabase project.
4. Store the complete Edge Function URL (`https://<project-ref>.supabase.co/functions/v1/monitor-jobs`) as Vault secret `monitor_function_url`, and store the matching `MONITOR_FUNCTION_SECRET` as Vault secret `monitor_function_secret`. Do not place either secret in source-controlled SQL or ordinary tables.
5. Schedule the two existing job types from the SQL editor:

```sql
select cron.schedule(
  'monitor-expiry-daily',
  '0 6 * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'monitor_function_url'),
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'x-monitor-function-secret',
        (select decrypted_secret from vault.decrypted_secrets where name = 'monitor_function_secret')
      ),
      body := '{"job":"expiry"}'::jsonb,
      timeout_milliseconds := 30000
    );
  $job$
);

select cron.schedule(
  'monitor-notification-dispatch',
  '* * * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'monitor_function_url'),
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'x-monitor-function-secret',
        (select decrypted_secret from vault.decrypted_secrets where name = 'monitor_function_secret')
      ),
      body := '{"job":"notifications"}'::jsonb,
      timeout_milliseconds := 30000
    );
  $job$
);
```

The application-level database leases and deduplication protect overlapping invocations. After scheduling, inspect `cron.job`, `cron.job_run_details`, the `net._http_response` records, and the app's `job_runs` table. Alert on repeated failures and stale successful runs. These SQL schedules are instructions only; they have not been installed in a live project.

## Independent uptime worker

Deploy a separate, long-running Node.js process with network egress restricted to public HTTP/HTTPS destinations. It requires `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and optionally `WORKER_ID`, `WORKER_CONCURRENCY`, `WORKER_POLL_INTERVAL_SECONDS`, and `SSL_CHECK_INTERVAL_SECONDS`.

Run it with `npm ci && npm run worker:uptime`. The process polls for due HTTP endpoints and TLS assets, records timestamped results, opens/resolves incidents, and queues outage/recovery/certificate notifications. Use a process supervisor/container orchestrator to restart on failure, capture standard output/error, and alert if the process heartbeat stops. Keep it out of the dashboard request runtime. The worker validates URLs, DNS answers, and each redirect, pins HTTP requests and TLS inspection to a validated address while retaining the hostname for HTTP Host and TLS SNI/certificate verification, permits only ports 80/443, bounds response size and time, and never returns fetched HTTP response bodies to users.

Uptime check results and incident transitions currently use the service-role client from the worker. Limit the worker's network privileges and secret access; do not reuse its service key in browser code. For stronger consistency under concurrent worker instances, test the job lease and incident unique index against the deployed database before scaling horizontally.

The worker does not currently run RDAP refreshes or an independent health-reporting path. Do not advertise automatic RDAP discovery or worker-health alerts as active until a scheduled implementation is deployed and verified.

## Vercel, data retention, and recovery

1. Import the dashboard into Vercel and set the dashboard environment variables separately for Preview and Production. Never add `SUPABASE_SECRET_KEY`, provider tokens, or webhook secrets to `NEXT_PUBLIC_*` variables.
2. Deploy preview first. Complete the smoke test below with test data and test recipients, then promote to production.
3. Vercel does not install Supabase migrations, enable Supabase Cron, deploy Edge Functions, or keep the monitoring worker alive. Configure each independently.
4. Enable Supabase's supported automated backups/PITR for the selected plan. Before schema changes or major onboarding, take/verify a backup and record its retention window.
5. Periodically rehearse restore into a separate project. Verify restored data, Auth users/invitations as applicable, RLS, scheduled jobs, Vault secrets, and webhook URLs before switching traffic.
6. `check_results` is high-volume historical data. Choose a retention period appropriate to the plan and operational needs (the sample `.env.example` value is 30 days); implement and verify a database cleanup schedule before relying on that variable. Never delete incidents, notification outcomes, or renewal history as part of check-result cleanup.

## Production smoke test

- Confirm sign-up is disabled; sign in as the bootstrapped owner.
- Invite a test member, verify role restrictions, and remove the test account afterwards.
- Create a test client, website, domain asset, manual expiry date, and HTTPS monitoring endpoint.
- Confirm cross-organization reads and writes are denied using a separate test organization.
- Call the authenticated expiry job and confirm the expected notification is queued exactly once, including on a second invocation.
- Call the dispatcher and verify provider acceptance, then verify Resend delivery webhook handling and Telegram chat delivery with configured test accounts.
- Change the endpoint to a controlled test server that returns failure, then success; verify two consecutive failures open one incident and recovery resolves it with one recovery notification.
- Verify private-IP, metadata-IP, redirect-to-private-IP, DNS-rebinding, nonstandard-port, oversized-response, and timeout probes are blocked or bounded.
- Confirm `job_runs`, worker process supervision, backup completion, and restore procedure are visible to the operator.

## Troubleshooting

- **Cannot sign up:** confirm public signup is enabled in Supabase Auth, migration `0005_open_signup_membership.sql` is applied, and the confirmation redirect URL allows `/auth/callback`.
- **Signup has no workspace:** confirm exactly one organization exists and that migration `0005_open_signup_membership.sql` is applied. New accounts receive only the `member` role.
- **Initial Owner cannot create a workspace:** verify the signed-in address matches `BOOTSTRAP_OWNER_EMAIL` and the database has no organization. Bootstrap is first-owner-only.
- **No scheduled reminders:** inspect Cron history, `net._http_response`, Edge Function logs, job route status, `job_runs`, `notification_settings`, and the asset's expiry/timezone. Verify Vault secret names and dashboard job secret alignment.
- **Notification accepted but not delivered:** inspect the provider message reference, webhook endpoint configuration/signature secret, recipient verification, and provider event history. Retry only when the delivery outcome is known to be safe.
- **Telegram setup fails:** ensure the user/group started the bot, the challenge has not expired, and the webhook secret matches the configured webhook.
- **Worker has no recent results:** inspect process-supervisor state and logs, worker environment, database job lease, endpoint enabled flag, check interval, DNS, egress policy, and job run records. Do not expose full URLs or response payloads in shared logs.
- **Recovery:** restore a verified backup to a separate project first, confirm policies and secrets, then perform a controlled cutover. Prefer forward migrations for routine changes; never reset a production database to replay migrations.
