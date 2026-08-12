# Live paper engine

The Oracle worker now owns two processes inside one service:

1. the control agent, which stays online and polls Supabase commands;
2. a startable live paper engine, controlled from the Vercel dashboard.

The paper engine never calls Groww order-placement APIs.

## Runtime data flow

```text
Groww Feed
  -> NIFTY index LTP
  -> 50 NIFTY constituent LTPs
  -> nearest NIFTY future LTP

Groww Live Data REST
  -> constituent quotes (price + cumulative volume)
  -> nearest future quote (price + volume + OI)
  -> nearest-expiry NIFTY option chain (LTP + OI + volume + Greeks)

Oracle
  -> LiveMarketState
  -> SignalEngine
  -> Supabase signals
  -> paper-only orders/trades/outcome marks
```

The richer quote scan is intentionally slower than the feed. The feed supplies live prices and freshness, while quote snapshots provide the volume/OI fields used by the current formulas.

Default cadence:

- feed poll: 1 second
- quote scan: 20 seconds after each completed scan
- option-chain refresh: 20 seconds
- non-actionable signal persistence: at most once per 30 seconds

The REST limiter is configured below Groww's published Live Data limits.

## Paper order research protocol

An actionable signal still has to pass the existing risk engine. If it passes during 09:15–15:15 IST, the runner creates a database-only `OPEN` paper order using the option-chain LTP. It records marks after:

- 1 minute
- 3 minutes
- 5 minutes
- 10 minutes
- 15 minutes

At the 15-minute mark the research position is closed at the then-current option-chain LTP. This is a measurement policy, not a claim that 15 minutes is an optimal trading exit.

No new research entries are created after 15:15 IST so the full 15-minute mark can occur before the normal 15:30 close.

## Safety

- `EXECUTION_MODE` remains `paper`.
- There is no Groww `place_order` call in the live runner.
- One paper position at a time.
- Existing daily-loss, trade-count, loss-streak, stale-data and cooldown vetoes remain active.
- Fewer than 45 fresh constituent quotes blocks risk.
- Outside NSE session hours the engine waits without quote/option REST polling.

## Current weighting limitation

`config/nifty50.symbols.json` supplies the current bootstrap constituent list, but V1 uses equal constituent weights in the cash score. NIFTY is a free-float market-cap weighted index, so proper time-varying index weights should be added before treating this score as production-grade.

## Deploy

Apply `supabase/migrations/202608120004_live_paper_engine.sql` before starting the new worker code.

Then update Oracle:

```bash
cd ~/Growing-Trader
git pull
source .venv/bin/activate
pip install -e '.[dev]'
set -a
source ~/api.env
set +a
nifty-engine control-agent
```

Once Oracle is online, use **Start paper engine** in the dashboard. Use **Stop paper engine** to stop only market collection/strategy execution while leaving the Oracle control agent online.
