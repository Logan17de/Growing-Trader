# Growing Trader dashboard

Deploy `apps/web` as the Vercel project root. The dashboard is a private server-side control plane; it does not call Groww directly. Groww requests are executed by the long-running Oracle worker so broker traffic keeps the Oracle reserved/static public IP.

## Required Vercel environment variables

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` — server secret (`sb_secret_...` is supported)
- `BROKER_CREDENTIAL_ENCRYPTION_KEY` — base64 for exactly 32 random bytes
- `DASHBOARD_SESSION_SECRET` — random value of at least 32 characters; signs sessions and hashes OTP challenges
- `RESEND_API_KEY` — server-side Resend key used for dashboard login codes and manual report mail
- `TRADING_REPORT_FROM` — verified sender used for dashboard login codes and report mail
- `DASHBOARD_LOGIN_EMAIL` — private recipient for login codes; if omitted, `TRADING_REPORT_TO` is used
- `TRADING_REPORT_TO` — report recipient and fallback dashboard-login recipient

`DASHBOARD_PASSWORD` is no longer used. Opening the unauthenticated app automatically sends a six-digit one-time code to the configured private email. Codes expire after 10 minutes, are limited to five attempts, and cannot be resent more than once per minute from the same hashed request fingerprint.

Never expose the Supabase server secret, dashboard secrets, Resend key, or credential encryption key through `NEXT_PUBLIC_` variables. The hardened dashboard does not require browser-side Supabase access.

## Security model

Groww API key/secret values are submitted to a server-side Vercel route over HTTPS. The server encrypts each value with AES-256-GCM before writing it to the private `broker_credentials` table. Stored credentials are never returned to browser code. The Oracle worker has the same encryption key, decrypts the credentials locally, and is the only component that authenticates to Groww.

Dashboard login uses a separate server-only `dashboard_login_challenges` table. Only a HMAC of each one-time code is stored; plaintext codes and the login email are never written to that table. RLS is enabled and browser roles have no table privileges. Successful verification creates a signed HttpOnly, Secure, SameSite=Strict dashboard session cookie lasting up to 12 hours.

Apply all Supabase migrations in numeric order. Migration `202608120003_control_plane_hardening.sql` removes the earlier anonymous read policies, prevents duplicate active commands, and marks abandoned running commands failed after their worker lease expires. Migration `202608210014_dashboard_email_otp.sql` adds the private OTP challenge store.

Changing `DASHBOARD_SESSION_SECRET` invalidates existing dashboard sessions and outstanding OTP codes. Changing Groww credentials invalidates the previous broker verification state until authentication is tested again.

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
