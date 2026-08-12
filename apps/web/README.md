# Growing Trader dashboard

Deploy `apps/web` as the Vercel project root. The dashboard is a private server-side control plane; it does not call Groww directly. Groww requests are executed by the long-running Oracle worker so broker traffic keeps the Oracle reserved/static public IP.

## Required Vercel environment variables

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` — server secret (`sb_secret_...` is supported)
- `BROKER_CREDENTIAL_ENCRYPTION_KEY` — base64 for exactly 32 random bytes
- `DASHBOARD_PASSWORD` — password used to open the control dashboard
- `DASHBOARD_SESSION_SECRET` — random value of at least 32 characters

Never expose the Supabase server secret, dashboard secrets, or credential encryption key through `NEXT_PUBLIC_` variables. The hardened dashboard no longer requires browser-side Supabase access.

## Security model

Groww API key/secret values are submitted to a server-side Vercel route over HTTPS. The server encrypts each value with AES-256-GCM before writing it to the private `broker_credentials` table. Stored credentials are never returned to browser code. The Oracle worker has the same encryption key, decrypts the credentials locally, and is the only component that authenticates to Groww.

Apply all Supabase migrations in numeric order. Migration `202608120003_control_plane_hardening.sql` removes the earlier anonymous read policies, prevents duplicate active commands, and marks abandoned running commands failed after their worker lease expires.

Changing `DASHBOARD_PASSWORD` invalidates existing dashboard sessions. Changing Groww credentials invalidates the previous broker verification state until authentication is tested again.

## Oracle worker

Configure these on Oracle:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `BROKER_CREDENTIAL_ENCRYPTION_KEY` (exactly the same value as Vercel)

Then run:

```bash
nifty-engine control-agent
```

The agent sends heartbeats, claims dashboard commands atomically, decrypts Groww credentials locally, performs authentication/market-data tests, and returns sanitized results to the dashboard.

The dashboard `STOP` command now terminates the control-agent process cleanly after recording its final `stopped` heartbeat. If the worker is later managed by systemd, use a restart policy that does not automatically restart a clean intentional stop.

Live order execution is intentionally not exposed by this dashboard. The current control plane remains paper-only.
