# Live paper engine

The Oracle worker owns two processes inside one service:

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
  -> cash pressure / breadth / participation / heavyweight confirmation
  -> futures confirmation
  -> experimental near-ATM option activity confirmation
  -> synthetic NIFTY VWAP confirmation
  -> SignalEngine
  -> Supabase signals + NIFTY aggregate-volume series
  -> paper-only orders/trades/outcome marks
```

The richer quote scan is intentionally slower than the feed. The feed supplies live prices and freshness, while quote snapshots provide the volume/OI fields used by the current formulas.

Default cadence:

- feed poll: 1 second
- quote scan: 20 seconds after each completed scan
- option-chain refresh: 20 seconds
- strategy-parameter refresh from Supabase: 30 seconds
- non-actionable signal persistence: at most once per 30 seconds

The REST limiter is configured below Groww's published Live Data limits.

## Full strategy inputs

The paper direction score now contains the full research set discussed for this strategy:

- NIFTY constituent relative activity, price direction, breadth and participation;
- explicit heavyweight confirmation;
- NIFTY futures price/activity, OI confirmation and basis change;
- low-weight experimental near-ATM option-chain activity from incremental CE/PE volume, OI change and IV skew;
- a synthetic NIFTY VWAP built from NIFTY spot observations weighted by aggregate constituent turnover.

The option activity feature is a research hypothesis, not an assertion about buyer/seller identity. Greeks still primarily select the option contract after direction is decided.

## DB-backed thresholds

Migration `202608120005_full_strategy_observability.sql` creates `strategy_parameters` and seeds every `StrategyParams` value: formula weights, breakout/reversal thresholds, option filters, entry timing, dynamic exits and risk limits.

The Oracle runner reloads the table every 30 seconds. `StrategyParams` validation is applied after each reload, so invalid weight groups or invalid ranges fail closed rather than silently becoming active.

The same migration adds `nifty_constituent_config`. Real index weights can be populated there. The runner uses DB index weights only if the complete configured NIFTY universe has positive weights; otherwise it remains explicitly equal-weighted rather than mixing partial real weights with defaults.

## Aggregate NIFTY-50 volume research series

`nifty_volume_series` stores one observation after each valid quote scan:

- NIFTY LTP and synthetic VWAP;
- summed incremental share volume across the 50 constituents;
- summed constituent turnover (`delta volume * stock price`);
- cash pressure, breadth, participation and heavyweight score;
- futures, option-activity, VWAP and combined direction scores.

This is intentionally called a synthetic NIFTY-50 constituent aggregate. It is not exchange-reported volume for the NIFTY index itself.

Migration `202608120006_nifty_volume_minute_view.sql` aggregates those scan rows into one minute buckets so `/strategy` can chart the full session without bloating the main control-plane heartbeat response.

The Vercel research view is available at `/strategy` and displays the full-session aggregate chart plus every DB-backed threshold.

## Entry timing

The opening market is collected from 09:15 IST, but new entries are blocked for `opening_no_entry_minutes` (default 10). With defaults, the first possible paper entry is 09:25 IST. New entries still stop at 15:15 IST.

## Dynamic paper scalp exits

An open research position can now close before 15 minutes for:

- option-premium stop loss;
- option-premium profit target;
- trailing stop after a configured profit activation;
- material cross-market pressure flip against the entry direction;
- adverse failure back through the entry support/resistance level;
- maximum holding time.

The existing 1/3/5/10/15-minute outcome marks are retained whenever a position survives to those horizons. Exit values are research defaults and are expected to be calibrated from paper observations rather than treated as profitable constants.

## Safety

- `EXECUTION_MODE` remains `paper`.
- There is no Groww `place_order` call in the live runner.
- One paper position at a time.
- Existing daily-loss, trade-count, loss-streak, stale-data and cooldown vetoes remain active.
- Fewer than the DB-configured minimum fresh constituent quotes blocks risk.
- Outside NSE session hours the engine waits without quote/option REST polling.

## Deploy

Apply migrations in order through `202608120006_nifty_volume_minute_view.sql`.

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
