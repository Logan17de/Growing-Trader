from datetime import date

from nifty_engine.reporting import (
    build_report_summary,
    calculate_trade_metrics,
    largest_market_watch_move,
    market_summary,
    rows_for_month,
    rows_for_session,
    strategy_metrics,
)


def trade(when: str, pnl: float, *, mode: str = "paper", strategy: str = "S/R Breakout"):
    return {
        "executed_at": when,
        "pnl": pnl,
        "mode": mode,
        "strategy": strategy,
        "trading_symbol": "NIFTY-DEMO",
    }


def test_trade_metrics_include_drawdown_and_expectancy():
    metrics = calculate_trade_metrics([
        {"pnl": 1000}, {"pnl": -400}, {"pnl": -800}, {"pnl": 500},
    ])
    assert metrics.trades == 4
    assert metrics.wins == 2
    assert metrics.losses == 2
    assert metrics.net_pnl == 300
    assert metrics.gross_profit == 1500
    assert metrics.gross_loss == -1200
    assert metrics.win_rate == 0.5
    assert metrics.profit_factor == 1.25
    assert metrics.expectancy == 75
    assert metrics.max_drawdown == -1200
    assert metrics.best_trade == 1000
    assert metrics.worst_trade == -800


def test_session_and_month_filters_use_ist_date():
    rows = [
        trade("2026-08-16T18:40:00+00:00", 100),  # 00:10 IST on Aug 17
        trade("2026-08-17T09:30:00+05:30", 200),
        trade("2026-07-31T10:00:00+05:30", 300),
    ]
    session = date(2026, 8, 17)
    assert len(rows_for_session(rows, session)) == 2
    assert len(rows_for_month(rows, session)) == 2


def test_strategy_attribution_is_kept_separate():
    rows = [
        trade("2026-08-17T10:00:00+05:30", 1000, strategy="S/R Breakout"),
        trade("2026-08-17T10:30:00+05:30", -500, strategy="S/R Reversal"),
    ]
    grouped = strategy_metrics(rows)
    assert grouped["S/R Breakout"].net_pnl == 1000
    assert grouped["S/R Reversal"].net_pnl == -500


def test_market_summary_uses_first_last_and_sums_volume():
    rows = [
        {"observed_at": "2026-08-17T09:15:00+05:30", "nifty_ltp": 24000, "constituent_volume_delta": 10, "constituent_turnover": 100, "breadth": 0.4, "participation": 0.7},
        {"observed_at": "2026-08-17T09:16:00+05:30", "nifty_ltp": 24024, "constituent_volume_delta": 20, "constituent_turnover": 200, "breadth": 0.6, "participation": 0.9, "cash_pressure": 0.5},
    ]
    result = market_summary(rows)
    assert result["open"] == 24000
    assert result["close"] == 24024
    assert result["change_points"] == 24
    assert result["change_pct"] == 0.001
    assert result["volume"] == 30
    assert result["turnover"] == 300
    assert result["breadth"] == 0.6


def test_market_watch_selects_largest_absolute_labeled_move():
    rows = [
        {"observed_at": "2026-08-17T10:00:00+05:30", "nifty_move_1m_bps": 10, "nifty_move_5m_bps": 20, "nifty_move_15m_bps": 30},
        {"observed_at": "2026-08-17T11:00:00+05:30", "nifty_move_1m_bps": -12, "nifty_move_5m_bps": -55, "nifty_move_15m_bps": -40, "cash_pressure": -0.8},
    ]
    result = largest_market_watch_move(rows)
    assert result is not None
    assert result["horizon"] == "5m"
    assert result["move_bps"] == -55
    assert result["cash_pressure"] == -0.8


def test_report_keeps_paper_live_separate_and_adds_monthly_pnl():
    trades = [
        trade("2026-08-05T10:00:00+05:30", 2000, mode="live"),
        trade("2026-08-17T10:00:00+05:30", 1000, mode="live"),
        trade("2026-08-17T11:00:00+05:30", 500, mode="paper"),
    ]
    summary = build_report_summary(
        session_date=date(2026, 8, 17),
        trade_rows=trades,
        minute_rows=[],
        watch_rows=[],
        metadata={"execution": {"mode": "live", "live_armed": False}, "paper_account_equity": 300000},
    )
    assert summary["primary_mode"] == "live"
    assert summary["modes"]["live"]["daily"]["net_pnl"] == 1000
    assert summary["modes"]["live"]["monthly"]["net_pnl"] == 3000
    assert summary["modes"]["paper"]["daily"]["net_pnl"] == 500
    assert summary["starting_balance"] is None
    assert summary["ending_balance"] is None
