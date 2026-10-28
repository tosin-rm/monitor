# Monitor WordPress Connector API (schema 1.0 and 1.1)

The connector is site initiated and read-only. It sends inventory to Monitor; it cannot issue WordPress commands. Production requests use HTTPS. The WordPress site never calls Supabase directly.

## Pair a site

An authorized Monitor administrator creates a single-use pairing code for an active WordPress website. The code expires after 15 minutes and is shown once.

`POST /api/connectors/wordpress/pair`

```json
{ "pairing_code": "<one-time-code>" }
```

On success (201), Monitor returns the stable connection ID and per-connection secret once:

```json
{
  "connection_id": "<uuid>",
  "secret": "<base64url-secret>",
  "report_url": "/api/connectors/wordpress/report",
  "schema_version": 1
}
```

Monitor stores the secret using AES-256-GCM encryption. The connector stores it in a non-autoloaded WordPress option and must not log it. Pairing again rotates the secret for the same connection.

## Authentication and report submission

`POST /api/connectors/wordpress/report` accepts bodies up to 256 KiB and up to 500 plugins. Requests are limited to 10 per connection per minute. The signed timestamp tolerance is ±5 minutes; `collected_at` can be at most seven days old or five minutes in the future.

Required headers:

```text
Content-Type: application/json
X-Monitor-Connection: <connection_id UUID>
X-Monitor-Timestamp: <Unix seconds, decimal>
X-Monitor-Request-Id: <request_id UUID>
X-Monitor-Signature: <hex HMAC-SHA256>
```

The signature is `HMAC_SHA256(secret, timestamp + "." + request_id + "." + exact_raw_body)`. The request ID must match the JSON `request_id`. A request ID is accepted once per connection for reports. Signed revocation uses a fresh UUID request ID and the same signature scheme, with a body containing the matching `connection_id`.

### Schema 1.0

Schema 1.0 remains accepted during migration and contains the inventory fields without a `security` object. Legacy plugin update status uses `update_status` (`available`, `unavailable`, or `unknown`).

### Schema 1.1

Schema 1.1 accepts the plugin connector contract. Each plugin has `slug`, `name`, `version`, `active`, `update_available` (`true`, `false`, or `null`), and `update_version` (string or null). Monitor maps update availability into its display status. Update metadata is not vulnerability intelligence.

The required 1.1 `security` shape is:

```json
{
  "vulnerability_data": {
    "status": "unavailable",
    "source": null,
    "checked_at": null,
    "findings": [],
    "note": "No approved vulnerability source is configured on this site; Monitor should perform central lookups using plugin slug and installed version."
  },
  "suspicious_activity": { "status": "unsupported", "source": null, "findings": [] },
  "last_successful_scan_at": null,
  "scan_status": "unsupported"
}
```

Status values are `completed`, `stale`, `unavailable`, `not_run`, `unsupported`, and `error`. Monitor stores the 1.1 object as received, preserving statuses, null timestamps, and empty findings. An empty findings list is clean only when its source status is `completed`; `unavailable`, `unsupported`, `not_run`, and `error` are shown as unknown. A successful scan timestamp is accepted only with a completed or stale scan state; the connector must provide it from scanner completion metadata, never inventory time.

The connector currently has no vulnerability provider or scanner integration. Monitor performs plugin advisory matching centrally using plugin slug and installed version. Feed freshness, errors, and uncovered slugs remain distinct from no advisory matches. A missing match does not establish that a plugin is safe. No scanner completion is inferred from report timestamps.

### Validation and responses

The receiver validates the bounded raw JSON body, then authenticates the connection and exact raw body HMAC before rate-limited persistence. Website and organization ownership come from the paired connection. Malformed/unsupported payloads return 400; oversized payloads return 413; stale signatures, inactive connections, and invalid signatures return 401; replayed IDs return 409; rate limits return 429 with `Retry-After`; persistence failures return 503. Successful reports return 202.

Do not send comment records or identifiers, author/user data, IP addresses, post content, credentials, raw logs, filesystem content, or filesystem paths. The connector is inventory-only and has no remediation API.

## Revoke

Monitor administrators can revoke a connection from the website security panel. Revocation disables the connection and removes its credential server-side. The connector's local disconnect action removes its local credential even if remote revocation is unavailable.

## Deployment

Set `WORDPRESS_CONNECTOR_ENCRYPTION_KEY` to a base64 encoding of exactly 32 random bytes in the server-side secret manager. Apply migrations `0009_wordpress_connector.sql`, `0010_wordpress_security_reports.sql`, `0011_wordpress_vulnerability_feed.sql`, and `0012_wordpress_connector_schema_11.sql` before deployment. Configure `WORDFENCE_INTELLIGENCE_API_KEY` only in Monitor's server/worker environment and schedule the vulnerability feed worker as described in `docs/operations.md`.

Reports are retained for 365 days. Old reports and expired nonces are pruned during report ingestion.
