# GitHub-driven Oracle and Supabase automation

This setup removes the normal need to SSH from PowerShell.

## What happens automatically

### Every weekday at 09:10 Asia/Kolkata

`.github/workflows/oracle-start.yml`:

1. checks out the latest `main` branch;
2. applies any pending SQL files from `supabase/migrations`;
3. starts the OCI Compute instance;
4. waits for SSH;
5. updates `/home/ubuntu/Growing-Trader` to `origin/main`;
6. installs/updates and enables the `growing-trader` systemd service;
7. starts the Oracle control agent;
8. starts PAPER automatically, or LIVE only if LIVE was already explicitly armed.

LIVE is intentionally not automatically armed.

### Every weekday at 15:10 Asia/Kolkata

`.github/workflows/oracle-stop.yml`:

1. asks the Oracle agent to activate the kill switch and close the managed position;
2. waits until the engine/DB report flat;
3. stops the trading engine;
4. disarms LIVE;
5. stops the systemd control-agent service;
6. sends OCI `SOFTSTOP` to the VM.

If a LIVE position/order remains unresolved, the workflow fails **before** the OCI stop step. The VM is deliberately left running rather than removing Oracle-managed protection from a real position.

### Whenever `main` changes

`.github/workflows/deploy-main.yml`:

1. applies pending Supabase migrations automatically;
2. checks whether the Oracle VM is running;
3. if the VM is running and there is no active/unresolved LIVE order, updates and restarts the systemd service;
4. if a LIVE position/order is active, defers the Oracle restart until the next safe boot.

If the VM is stopped, nothing needs to be done: the morning workflow pulls the latest `main` automatically.

## One-time GitHub setup

Open the private repository in GitHub and go to **Settings → Secrets and variables → Actions**.

Create these repository secrets:

| Secret | Value |
| --- | --- |
| `SUPABASE_DB_URL` | Supabase Postgres connection URI. Prefer the SSL-enabled Session Pooler URI for GitHub-hosted runners. |
| `OCI_TENANCY_OCID` | OCI tenancy OCID. |
| `OCI_USER_OCID` | OCI user OCID for the API signing key. |
| `OCI_FINGERPRINT` | Fingerprint shown for the OCI API signing key. |
| `OCI_API_PRIVATE_KEY` | Full PEM private key generated for OCI API signing. This is **not** the VM SSH key. |
| `OCI_REGION` | OCI region identifier containing the instance. |
| `OCI_INSTANCE_OCID` | OCID of the `nifty-trading-engine` Compute instance. |
| `ORACLE_SSH_PRIVATE_KEY` | Full private SSH key that authenticates as the Oracle Ubuntu user. |

Optional repository variables:

| Variable | Default |
| --- | --- |
| `ORACLE_HOST` | `193.123.166.128` |
| `ORACLE_USER` | `ubuntu` |

The OCI API user must have permission to start/stop the target Compute instance.

## OCI API key

In OCI Console, open the user's **API keys** page and add/generate an API signing key. Save the downloaded PEM private key once. OCI shows a configuration preview containing the `user`, `fingerprint`, `tenancy`, and `region` values used by the GitHub secrets above.

The OCI API signing key and the VM SSH key are different credentials.

## Supabase migration behavior

`scripts/apply_remote_migrations.sh` keeps a checksum-tracked migration ledger in the non-exposed `private` schema.

On its first run it executes the repository migrations in filename order. The SQL migrations are intentionally written to be repeatable against the existing project. After each successful file, its filename/version/checksum is recorded. Later deployments run only new migration files.

If an already-recorded migration file is edited later, deployment fails rather than silently changing migration history. Add a new migration instead.

The runner sends `NOTIFY pgrst, 'reload schema'` after successful migration application.

## Oracle systemd behavior

`scripts/install_oracle_service.sh` installs `growing-trader.service` and enables it for boot.

Before each service start it:

- fetches `origin/main`;
- hard-resets the server checkout to `origin/main`;
- refreshes the editable Python installation;
- starts `nifty-engine control-agent` using `/home/ubuntu/api.env`.

The Oracle checkout is therefore deployment state, not a place for uncommitted server edits.

The service uses `Restart=on-failure`, not `Restart=always`, so intentional shutdown remains stopped.

## Manual controls without PowerShell

Both Oracle lifecycle workflows support **Run workflow** from GitHub Actions, so start/stop can also be triggered from the browser.

Normal strategy start/stop, PAPER/LIVE selection, LIVE arming, kill switch, position exits, and thresholds remain available in the Growing Trader web dashboard.

## Important LIVE boundary

LIVE stops/targets/trailing logic remains application-managed by Oracle. The scheduled shutdown therefore refuses to stop OCI until no managed LIVE position/order remains. If the flattening check fails, investigate from the Groww broker UI/dashboard; do not force-stop the VM with an unresolved position.
