# Market Watch Research Recorder

The Market Watch layer is not an executable trading strategy. It continuously records the market state so new hypotheses can be discovered and tested without changing the LIVE/PAPER execution rules.

## Existing raw sources

Oracle already persists the following during a valid market session:

- `market_snapshot_history`: full market snapshot at the quote-scan cadence, including NIFTY spot, all resolved NIFTY-50 constituent ticks, NIFTY futures price/volume/OI, near-ATM option contracts, active S/R levels, data age, and the exact strategy parameters in force.
- `market_constituent_series`: one row per constituent per scan with price move, volume delta/rate, RVOL, weight, sector, and heavyweight flag.
- `option_chain_series`: nearest option strikes with LTP, OI, volume, Greeks, IV, and bid/ask.
- `nifty_volume_series`: compact aggregate participation metrics per valid quote scan.
- `signals`: the complete calculated signal payload persisted on actionable events and otherwise at the configured signal persistence cadence.

## Analysis-ready views

Migration `202608130012_market_watch_research_log.sql` adds:

- `market_watch_log`: one flattened, machine-readable row per persisted signal observation. It combines cash participation, futures raw state and calculated confirmation, option OI/volume/IV positioning, VWAP, level state, contract/risk state, and future NIFTY outcomes.
- `market_watch_labeled`: adds research-only big-move labels using DB-configurable thresholds.
- `market_watch_big_moves`: filters the labeled view to observations associated with a notable 1m, 5m, or 15m future move.

Future labels are measured at approximately 1, 3, 5, 10, and 15 minutes after each observation. The log also includes maximum favorable/adverse NIFTY movement over the following 15 minutes.

These labels are retrospective research outcomes. They are never consumed by the LIVE execution engine and therefore cannot leak future information into a real-time decision.

## Research thresholds

The following application settings are seeded in Supabase and are used only to flag observations for study:

- `research_big_move_1m_bps` = 15
- `research_big_move_5m_bps` = 30
- `research_big_move_15m_bps` = 50

Changing these settings changes research classification only. It does not create or alter a trading strategy.

## Daily machine-readable export

`.github/workflows/research-export.yml` runs at 15:25 Asia/Kolkata on weekdays and can also be run manually for a selected session date.

It uploads a 90-day GitHub Actions artifact named `market-research-YYYY-MM-DD` containing:

- `market-watch-YYYY-MM-DD.jsonl`: every analysis-ready observation for the session.
- `big-moves-YYYY-MM-DD.jsonl`: only observations that satisfy at least one research big-move threshold.
- `summary-YYYY-MM-DD.json`: row counts and maximum observed future moves.

The artifact is intentionally separate from Git history so high-frequency market data does not bloat the repository.

## Intended research workflow

1. Let Market Watch record normal sessions without changing execution rules.
2. Inspect large-move observations and the 5-15 minutes preceding them.
3. Compare cash volume/breadth/heavyweights, futures price-volume-OI/basis, options volume/OI/IV, and VWAP conditions.
4. Form a hypothesis only after repeated patterns appear across multiple independent sessions.
5. Implement the hypothesis as a new research strategy and replay it against sealed historical sessions.
6. Only promote a setup to PAPER/LIVE after out-of-sample validation and risk review.

This separation keeps market observation, strategy discovery, and execution distinct.
