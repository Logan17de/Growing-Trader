# Growing Trader dashboard

Deploy `apps/web` as the Vercel project root. The dashboard is a control plane; it does not call Groww directly. Groww requests are executed by the long-running Oracle worker so broker traffic keeps the Oracle reserved/static public IP.

## Required Vercel environment variables

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `BROKER_CREDENTIAL_ENCRYPTION_KEY` — base64 for exactly 32 random bytes
- `DASHBOARD_PASSWORD` — password used to open the control dashboard
- `DASHBOARD_SESSION_SECRET` — random value of at least 32 characters

Optional browser signal-stream variables can still be configured if needed:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Never prefix the service-role key, dashboard secrets, or credential encryption key with `NEXT_PUBLIC_`.

## Security model

Groww API key/secret values are submitted to a server-side Vercel route over HTTPS. The server encrypts each value with AES-256-GCM before writing it to the private `broker_credentials` table. The stored values are never returned to browser code. The Oracle worker has the same encryption key, decrypts the credentials locally, and is the component that authenticates to Groww.

Sensitive control-plane tables have RLS enabled and no `anon`/`authenticated` policies. Vercel and Oracle use the Supabase service role only from server-side environments.

## Oracle worker

After applying the Supabase migrations, configure these on Oracle:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `BROKER_CREDENTIAL_ENCRYPTION_KEY` (same value as Vercel)

Then run:

```bash
nifty-engine control-agent
```

The agent sends a heartbeat, claims dashboard commands atomically, decrypts Groww credentials locally, performs authentication/market-data tests, and returns sanitized results to the dashboard.

Live order execution is intentionally not exposed by this dashboard. The current control plane remains paper-only.
