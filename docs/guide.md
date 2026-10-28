# Monitor user and developer guide

This guide is for the people who build and operate Monitor, the internal team that uses it, and the clients whose websites and services are recorded in it.

## What Monitor is

Monitor is a private operations dashboard for keeping track of client websites, infrastructure expiry dates, uptime checks, incidents, and team notifications. It is intended for authorized members of the web development team.

**Clients do not currently sign in to Monitor.** There is no client portal. Team members remain responsible for verifying renewal dates, contacting clients when a decision or payment is needed, and recording the outcome in the app.

## Guide for developers

### Project and local setup

The dashboard uses Next.js App Router, TypeScript, Tailwind CSS, Supabase Auth/PostgreSQL, and server-side data access. A separate Node process runs uptime and TLS checks.

1. Install dependencies with `npm ci`.
2. Copy `.env.example` to `.env.local` and fill in values for a development Supabase project. Never copy production secrets into source control or expose server-only secrets in browser variables.
3. Start the dashboard with `npm run dev`.
4. Start the worker separately with `npm run worker:uptime` after configuring its Supabase URL and server-only secret.
5. Before submitting a change, run:

   ```sh
   npm run lint
   npm run typecheck
   npm test
   npm run build
   ```

For Supabase project setup, migrations, credentials, schedules, backups, and deployment, follow [the operations guide](./operations.md).

### Code map

| Area | Location |
| --- | --- |
| Dashboard routes | `app/` |
| Auth context and role permissions | `lib/auth/` |
| Supabase clients | `lib/supabase/` |
| Versioned database schema and policy changes | `supabase/migrations/` |
| Expiry day and reminder rules | `lib/expiry/` |
| Notification channel adapters and retry policy | `lib/notifications/` |
| Expiry job and notification dispatcher | `lib/jobs/` |
| RDAP parsing/provider helpers | `lib/rdap/` |
| TLS certificate inspection | `lib/ssl/` |
| URL, DNS, and HTTP SSRF protections | `lib/ssrf/` |
| Uptime and certificate worker | `worker/uptime.ts` |
| Automated tests | `tests/` |

### Engineering and security rules

- Keep data scoped to the authenticated organization. Enforce authorization in server actions and database policies/functions; hiding a control in the UI is not access control.
- Never send the Supabase secret/service-role key, Resend key, or Telegram token to browser code. Do not write secret values into logs, errors, tests, or audit metadata.
- Keep notifications durable and deduplicated in the database outbox. A provider accepting a request is not the same as confirmed delivery.
- Treat every stored website URL and hostname as untrusted. Preserve the SSRF controls: only HTTP/HTTPS on ports 80/443, validate all DNS answers, pin connections to a validated IP, revalidate every redirect, and keep response/time limits.
- Use mocked external providers in unit tests. Do not send real email, Telegram messages, or network probes from tests.
- Add database changes as forward migrations. Do not reset or rewrite a database containing user data.
- Be precise about integration status. RDAP helpers exist, but scheduled RDAP refresh is not currently active. Do not claim that automatic expiry discovery is running until that worker/job is implemented and verified.

### Current implementation boundary

The app has private team authentication, client and website inventory, assets and manual renewal history, expiry reminders/outbox, Resend and Telegram integrations, notification history/settings, an incident timeline, and a separate uptime/TLS worker.

Before production use, operators still need to apply and verify the migrations against their Supabase project, configure and test provider credentials, deploy and schedule the Edge Function jobs, and run the operational smoke tests. Database integration/RLS testing and external-provider delivery have not been verified in this development environment. WhatsApp delivery, client login, provider-specific hosting renewal discovery, scheduled RDAP refresh, worker-health alerts, and check-result cleanup are not available.

## Guide for the team

### Sign-in and roles

Team-member signup is open after the Owner has created the workspace and the operator enables new-user signup in Supabase Auth. Every self-registered account joins the single existing workspace as a **Member**; the signup form cannot select an organization or role. There is no separate “developer” role:

- **Member:** view operational records and confirm renewals.
- **Admin:** manage clients, websites, assets, monitoring, notification settings, and team membership.
- **Owner:** admin permissions plus control over owner-level membership and the organization.

Owners/Admins remain restricted assignments made through trusted administration; signing up never grants elevated privileges. Developers who need to change or deploy the software also need access to the source-code repository and deployment environment. That is separate from Monitor account access; being a repository developer does not automatically grant dashboard access or Supabase production credentials.

Because signup is public, anyone who can complete Supabase Auth signup can view the team's operational data as a Member. Enable it only if that is acceptable for this workspace. Do not put production client data in the workspace before the team has reviewed this access model.

#### First owner setup: novice step-by-step

This section assumes you are setting up a new Monitor installation. It separates what the **deployment operator/developer** does from what the **first Owner** does. You do not need to be a programmer to accept the invitation and create the workspace, but the initial technical setup should be done by someone trusted to manage the hosting and database.

**A few terms first**

- **Supabase** is where Monitor stores its database and manages sign-in accounts.
- **The dashboard host** (for example, Vercel) is where the Monitor website runs.
- **The first Owner** is the person who controls the Monitor workspace. This person may also be an Admin, but the first account is created as Owner.
- **`BOOTSTRAP_OWNER_EMAIL`** is a server setting that says which email is allowed to create the very first workspace. Adding an address here does not create an account or send an email.
- **A migration** is a versioned SQL file that creates or updates the database structure and security rules. These must be applied before the app can work properly.

##### Part A — the developer/operator prepares the app

1. **Decide who will be the first Owner.** Agree on the exact email address with that person. They must be able to open that inbox. Ask them to tell you the address; do not ask for their password.
2. **Create a Supabase project.** Sign in to Supabase, create a new project for this Monitor installation, and save its database password in your password manager. Wait for project setup to finish. Do not use a database that contains unrelated or important existing data.
3. **Find the project URL and keys.** In the Supabase project, open **Project Settings → API** (the label may vary slightly). You need the Project URL, the publishable/anon key, and a server-only secret/service-role key. The URL and publishable key are used by the dashboard; the secret key gives powerful database access and must only be put in trusted server environments. Never send the secret key to the Owner in email or chat.
4. **Create the dashboard deployment.** Deploy the project from its source-code repository to the chosen hosting platform, such as Vercel. The deployment creates the web address people will visit, for example `https://monitor.example.com`. Use the real HTTPS address, not the example.
5. **Add the required environment settings to the dashboard host.** In the hosting platform's project settings, find **Environment Variables** and add the following names and values:

   | Name | What to enter |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | The Supabase Project URL from Part A, step 3 |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | The Supabase publishable key from Part A, step 3 |
   | `SUPABASE_SECRET_KEY` | The Supabase server-only secret/service-role key from Part A, step 3 |
   | `APP_BASE_URL` | The dashboard's full origin, e.g. `https://monitor.example.com` (no trailing `/login` or other page path) |
   | `BOOTSTRAP_OWNER_EMAIL` | The first Owner's exact email address |

   In Vercel, environment variables are under the project's **Settings → Environment Variables**. Select the environment you are deploying (normally Production). Mark secret keys as sensitive if the platform offers that option. Never put `SUPABASE_SECRET_KEY` in a name beginning `NEXT_PUBLIC_`.
6. **Configure Supabase's return addresses.** In Supabase, open **Authentication → URL Configuration**. Set **Site URL** to the dashboard origin, such as `https://monitor.example.com`. Add this exact redirect URL to the allowed redirect list: `https://monitor.example.com/auth/callback`. Replace the example host with your real dashboard host. This tells Supabase which app is allowed to receive users after they click an invitation link.
7. **Set the Supabase email templates to return to Monitor.** In Supabase, open **Authentication → Email Templates**. For **Invite user**, the link needs to send the one-time invite token to Monitor's callback so Monitor can establish the sign-in session. Use this link in that HTML template:

   ```html
   <a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&amp;type=invite&amp;next=%2Fset-password">Accept invitation</a>
   ```

   For **Reset password**, use the recovery token link:

   ```html
   <a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&amp;type=recovery&amp;next=%2Freset-password">Reset your password</a>
   ```

   The Site URL must be the Monitor website origin from Part A, step 6, and the `/auth/callback` URL must be in Supabase's allowed redirect list. For invitations sent from the Team page, Supabase's **Invite user** template must preserve the `token_hash` URL above; do not use only `{{ .ConfirmationURL }}` because Monitor's server callback needs the token hash. After changing the template, send a fresh invite and use that newest email link only once. Old invitation links cannot be reused after verification or expiry.
8. **Apply the database migration files.** Open the project files in the repository and locate `supabase/migrations/`. In the Supabase dashboard, open **SQL Editor → New query**. Open `0001_foundation.sql` in your code editor, copy its contents into the SQL Editor, check that the correct Supabase project is selected, and run it. Repeat, one file at a time and in this order: `0002_private_auth.sql`, `0003_notification_outbox.sql`, `0004_incident_workflow.sql`, then `0005_open_signup_membership.sql`. Keep public signup disabled until the workspace and Owner are set up below. Wait for each file to finish successfully before running the next. If a file reports an error, stop and ask a developer to investigate; do not skip ahead or repeatedly run it without understanding the error. Never run these files against a project containing data unless a database operator has reviewed the migration and backup plan.
9. **Keep public sign-up disabled during initial setup.** In Supabase, open **Authentication → Settings** (sometimes shown as **Sign In / Providers**). Leave **Allow new users to sign up** turned off until the workspace exists and the Owner has confirmed access. This avoids creating accounts that cannot yet join a workspace.
10. **Redeploy after setting environment values.** In your hosting platform, redeploy/restart the dashboard so it starts with the new settings. Open the dashboard address in a browser. Seeing the Monitor sign-in page is a good initial check; the workspace is not created yet.
11. **Check email invitations are enabled.** Supabase must be able to send Auth invitation emails. For a real team, configure Supabase's approved SMTP/email provider and sender. A project's default email service may have strict sending limits; do not assume invitations will reach the inbox until you test one.

##### Part B — create the first Owner account

There are two ways to create the first Auth account. **If Supabase reports “email rate limit exceeded,” use Option 2.** It creates the account in the Supabase project without sending an invitation email. It does not enable public sign-up or create an app-side authentication bypass.

**Option 1: email invitation**

11. In Supabase, open **Authentication → Users → Invite user**. Enter exactly the address configured in `BOOTSTRAP_OWNER_EMAIL` and send the invite. This is done in Supabase because Monitor has no workspace or Team page yet.
12. The Owner opens the newest invite email in a browser. The link should return to Monitor's `/auth/callback` with `token_hash` and `type=invite`; the app verifies the one-time link and creates the sign-in session.
13. Monitor displays **Set your password**. The Owner chooses a private password of at least 12 characters, confirms it, and saves it. An expired or rate-limited invitation must not be repeatedly retried; use a fresh invite after the limit clears, or follow Option 2.

**Option 2: create the user directly in Supabase (no invitation email)**

11. In the Supabase Dashboard, make sure you have selected the correct project, then open **Authentication → Users**.
12. Select **Add user** (sometimes labelled **Create user**) and choose **Create new user**, not **Invite user**.
13. Enter the exact email address configured in `BOOTSTRAP_OWNER_EMAIL`.
14. Create a strong, unique temporary password. If Supabase offers **Auto Confirm User**, **Confirm email**, or a similar option, turn it on. This marks the manually created account as verified so it can sign in without an email confirmation message. The exact wording may vary by Supabase Dashboard version.
15. Select **Create user** and wait for Supabase to show that the account exists in the Users list. This uses the project's administrative dashboard operation; it does not send an invite email and should avoid the Auth email-send rate limit.
16. Give the temporary password to the Owner only through a secure, private channel. Do not put it in this repository, an issue, or this chat. The Owner signs in at the deployed Monitor `/login` page using the created email and temporary password.
17. Once signed in, the Owner can open `https://<your-monitor-host>/set-password` directly, choose a new private password of at least 12 characters, confirm it, and save. This replaces the temporary password. The Owner should not share either password with the developer.

If Supabase does not show a create-user option or rejects the operation, stop and check that you are an authorized project administrator and selected the intended project. Do not expose a service-role key or enable public signup before the workspace and Owner are ready.

**Continue after either option**

18. If this is the first account and no organization exists yet, Monitor sends the Owner to **Workspace access**. They enter the organization name and timezone (an IANA name such as `Europe/London` or `America/New_York`) and select **Create workspace** once.
19. The Owner should land on the dashboard. Open **Team** and confirm the Owner email and Owner role. An empty dashboard is expected initially.

This first-owner bootstrap only works for the configured, signed-in `BOOTSTRAP_OWNER_EMAIL` while no organization exists. It cannot be repeated to grant access later.

##### Part C — give the developer and team their own access

16. **Enable member self-signup once the workspace is ready.** In Supabase Auth, enable **Allow new users to sign up** and configure a verified SMTP provider for reliable confirmation emails. Deploy the app containing `/signup`. Rate-limited signup emails require waiting for the Auth email limit to clear or using the configured SMTP provider; do not repeatedly submit the form.
17. **Teammates create their own accounts.** They visit `/signup`, enter their work email and a password, then confirm their email. Their account joins the existing workspace as a Member; they cannot choose another role during signup. Test with a separate account and verify that it cannot manage team roles.
18. **Grant elevated roles only through trusted administration.** An Owner can promote a Member to Admin from **Team**. Do not share the Owner's login. Owners/Admins remain responsible for reviewing who should have access because any person able to sign up can see the workspace's operational data as a Member.
19. **Give developers separate technical access if needed.** If a developer needs to edit or deploy the source code, grant access to the code repository and deployment platform separately. Dashboard Admin access does not automatically require production database keys. Share only the minimum access needed for their task.
20. **Add real operational data only after access works.** The team can now create a client, add that client's websites, and add domain/hosting/certificate records. Record only expiry dates that have been verified. Configure notification delivery and the background jobs/worker before relying on automated alerts.

**Stop here if you only added an email to `BOOTSTRAP_OWNER_EMAIL`.** That setting just identifies the eligible first Owner. It does not create a Supabase user, send an invitation, or create the workspace. Complete Part A and invite that same email from Supabase before the person tries to create the workspace.

The first-owner setup only works once, for the configured, signed-in email, and only while the database has no organization. It is not the normal process for adding people later.

##### If something goes wrong

- **The Owner gets no email:** check the spelling of the invited address, spam/quarantine folders, and Supabase's Auth email configuration. An Auth administrator can send a fresh invitation.
- **The invitation opens the wrong site or shows a redirect error:** confirm `APP_BASE_URL`, Supabase **Site URL**, and the allowed `/auth/callback` URL all use the same deployed host. Redeploy after changing host environment values.
- **The app says the user is not allowed to create the workspace:** check that the signed-in email matches `BOOTSTRAP_OWNER_EMAIL` and that the invitation was sent from the correct Supabase project. If an organization already exists, first-owner bootstrap cannot be repeated.
- **A migration fails:** stop. Record the migration filename and error message, but remove any secrets or personal data before sharing it with a developer. Do not skip the migration or rerun an incomplete SQL file blindly.
- **Someone created the wrong workspace or wrong Owner:** stop onboarding and contact the database operator. Do not edit role columns or delete database records by hand; recovery needs a reviewed and backed-up administrative procedure.

#### Inviting developers and other teammates

After the first owner has created the workspace:

1. An owner or admin signs in and opens **Team**.
2. They enter the teammate’s email and select Member or Admin. Only an owner can grant the Admin role; owner-role assignment is restricted to the owner.
3. Monitor sends an invitation email. The teammate opens the invitation, follows the link back to Monitor, sets a password at `/set-password`, then signs in at `/login`.
4. If the invitation expires or is sent to the wrong address, ask an owner/admin to arrange a fresh invitation. Never reuse another teammate’s account.

The invitation flow depends on Supabase Auth email delivery and the production redirect URL being configured. An account that can authenticate but has no organization membership is not automatically granted access; it must be invited by an authorized team administrator.

If you cannot access a page or action, ask an owner/admin to confirm your role and organization membership rather than sharing another person's credentials.

### Recommended setup workflow

1. **Add the client.** Use a clear client name and record contact details only when needed for the team's work.
2. **Add each website.** Associate it with the correct client, give it a recognizable name, and use its canonical HTTPS URL where available.
3. **Add service assets.** Create a separate record for each domain, hosting subscription, and SSL certificate. Add the provider, account reference (not a password), renewal URL, responsible party, and known expiry date.
4. **Record date provenance.** Mark manually confirmed dates as manual and record when they were verified. Unknown dates should stay unknown; do not estimate an expiry.
5. **Configure monitoring.** Add the required public HTTP/HTTPS endpoint and expected status codes. Avoid private/internal URLs and do not put credentials or secret query strings in monitored URLs.
6. **Review notification settings.** Configure team email recipients and/or link Telegram chats using the one-use flow. Send a test notification before relying on a channel.
7. **Review the dashboard and calendar.** Use upcoming renewals and the inventory to plan follow-up before services expire.

### Day-to-day use

- Use the **Light/Dark** control at the bottom-right of the screen to change the dashboard appearance. Your choice is saved in this browser and applies on your next visit; it does not change another teammate's setting.
- Check **Dashboard** for expiring/expired assets, downtime, incidents, and recent notification outcomes.
- Use **Clients** and **Websites** to update records; archive records rather than deleting them when a client engagement ends. Archiving preserves operational history.
- Use **Inventory** to filter services and review expiry date, provenance, verification, renewal status, and renewal history.
- Use **Expiry calendar** to plan renewal work. Calendar days use the organization's configured timezone.
- On renewal, confirm the new expiry date and record the confirmation method and useful notes. Do not mark a service renewed only because a provider page is reachable.
- Use **Incidents** to review an issue. Acknowledge or mark it investigating while work is underway. Resolve it when the issue is confirmed fixed; a later successful automated check can also resolve an outage.
- Use **Notifications** to distinguish queued, provider-accepted, delivered (where the provider reports it), and failed messages. Retry only eligible failures and check ambiguous provider outcomes first.
- Use **Team** and **Settings** only within your permissions. Keep sensitive access tokens out of notes and ordinary records.

### Renewal and alert expectations

Every known expiry date also gets a reminder on the calendar date one month before expiry. This reminder is sent through enabled channels; email requires email notifications enabled, at least one verified recipient, and a working Resend configuration. The default additional reminders are 30, 14, 7, 3, and 1 calendar day before domain/hosting expiry, and 14, 7, 3, and 1 day before certificate expiry. Expired follow-ups are controlled reminders after the first overdue day. Administrators can configure the day-based intervals.

Alerts depend on scheduled jobs being deployed and active, notification recipients being configured, and providers being reachable. A record in the dashboard is not itself proof that a reminder was sent or delivered. Check the notification history and current provider status.

Uptime and TLS checks depend on the separate worker staying online. If check timestamps become stale, report it to the designated operator; do not assume a stale status means the client website is down.

### Client information and communication

Monitor is an internal tool, not a client portal. Do not send clients a login invitation or direct them to manage Monitor records. When client action is required:

1. Verify the provider and expiry information using an authoritative account/source.
2. Contact the client's agreed point of contact through the normal approved channel.
3. Explain the service, due date, required decision/payment, and consequence of missing the deadline in plain language.
4. Do not share another client's data, internal incident notes, team-only account references, provider message IDs, credentials, or security configuration.
5. Record the outcome and updated verified date in Monitor, without storing payment-card data, passwords, or unrelated personal information.

#### Client-facing status update template

> **Subject:** Action needed: [service] for [website] renews on [date]
>
> We are tracking the [domain/hosting/certificate] for [website]. The current recorded renewal/expiry date is [date], last verified on [verification date/source]. Please confirm whether [renewal/payment/action] will be handled by your team or ours by [decision date]. We will update our records when the renewal is confirmed. If this date or responsibility is incorrect, please let us know.

Only use the verification wording when the date really has been checked. If it is not verified, say that the date is unconfirmed and ask the client/provider to confirm it.

#### Outage update template

> **Subject:** Website availability issue: [website]
>
> We are investigating an availability issue affecting [website/endpoint], first observed at approximately [time and timezone]. The latest check was [status/result]. We will send another update when we have confirmed the cause or recovery. At this stage, [state only what is known; do not speculate].

Keep client updates factual and avoid promising a recovery time unless it has been confirmed.

## Guide for clients

This section may be shared with clients after replacing bracketed details with the team's contact and service-specific information.

### What the monitoring service does

The web team keeps an internal record of the websites and services it manages for you. Depending on the service and the monitoring that has been enabled, the team may track renewal dates, check public website availability, inspect public TLS certificate validity, and contact you when a renewal or operational issue needs attention.

### What we may need from you

- Confirmation of who is responsible for renewing a domain, hosting plan, or certificate.
- Confirmation of a renewal date when it is not available from a reliable source.
- A timely decision or approval if a service is due for renewal.
- A current contact for operational notices.

Please do not send passwords, payment-card details, or account recovery codes by email or through monitoring notes. We will use the provider's approved access and payment process.

### What alerts mean

- An **expiry reminder** means a recorded expiry date is approaching or has passed; it is a prompt to verify and arrange renewal, not confirmation that a service has been renewed or cancelled.
- An **availability incident** means an automated check observed a problem according to the configured endpoint and status policy. It may require investigation and does not alone identify the root cause.
- A **certificate warning** means a TLS check found a validity, trust, or hostname issue requiring review.

Automated checks can be affected by maintenance, network conditions, provider outages, or the monitoring worker itself. The team verifies incidents before making claims about cause or impact.

### Client access and WhatsApp

Clients do not currently have accounts in Monitor. The team communicates relevant actions and status through the agreed client contact process.

WhatsApp notifications are not currently enabled. The application supports email and Telegram notification channels in its design, but actual delivery requires the team's provider configuration and successful testing. Do not rely on Monitor for WhatsApp alerts; use the agreed contact route until the team confirms otherwise.

For questions, corrections, or renewal requests, contact **[team contact name]** at **[team email/phone]** and include the website name and relevant service.
