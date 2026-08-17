# Daily Trading Email Report

Growing Trader sends a post-market HTML report from GitHub Actions. The report reads only persisted Supabase data; it does not call Groww and does not require Oracle to remain online.

## Delivery

Workflow: `.github/workflows/daily-trading-report.yml`

Schedule: weekdays at 15:35 Asia/Kolkata. It can also be run manually for a chosen session date.

Required GitHub Actions secrets for delivery:

- `RESEND_API_KEY`
- `TRADING_REPORT_TO`
- `TRADING_REPORT_FROM`
- existing `SUPABASE_DB_URL`

If the Resend secrets are not configured, the workflow still generates and archives the report artifact but skips delivery.

`TRADING_REPORT_FROM` must be a sender accepted by the configured Resend account/domain. `TRADING_REPORT_TO` may contain one email address.

## Report contents

- Daily realized P&L
- Monthly realized P&L
- Total trades, wins/losses, win rate and best trade
- Intraday cumulative P&L chart
- PAPER equity curve when a configured paper-equity baseline exists
- Win/loss performance snapshot, average win/loss, expectancy, profit factor and max drawdown
- S/R Breakout vs S/R Reversal attribution
- NIFTY intraday chart and NIFTY-50 constituent-derived volume/turnover/breadth/participation metrics
- Market Watch largest labeled move and the recorded cross-market conditions around it
- Lifecycle/safety status, unresolved LIVE orders and last known execution mode

PAPER and LIVE results are kept separate. The primary summary follows the execution mode persisted for the session; a secondary table shows both modes side by side when data exists.

## Accuracy boundaries

- LIVE P&L comes from persisted reconciled Groww fills/trades.
- PAPER P&L comes from simulated persisted trades.
- PAPER equity uses `app_settings.paper_account_equity` as the reporting baseline.
- The report does not fabricate LIVE starting/ending broker equity. Until broker balance snapshots are persisted, LIVE account-balance fields are shown as unavailable rather than estimated.
- NIFTY volume is the aggregate incremental traded-share volume of the NIFTY-50 constituents. It is not exchange-reported NIFTY index volume.
- Green/red market-volume semantics are price-direction proxies, not buyer/seller identity.

## Artifacts

Every workflow run uploads the generated HTML, JSON summary, CSV trade ledger and chart PNGs as a GitHub Actions artifact for 90 days.
