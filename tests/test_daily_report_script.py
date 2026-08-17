from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys


def test_daily_report_script_renders_artifacts(tmp_path: Path):
    input_dir = tmp_path / "input"
    output_dir = tmp_path / "output"
    input_dir.mkdir()
    (input_dir / "trades.jsonl").write_text(
        "\n".join([
            json.dumps({
                "executed_at": "2026-08-17T10:00:00+05:30", "mode": "paper", "execution_source": "algo", "strategy": "S/R Breakout",
                "signal_event": "breakout", "trading_symbol": "NIFTY-DEMO-CE", "quantity": 65,
                "entry_price": 100, "fill_price": 110, "pnl": 650, "exit_reason": "target",
            }),
            json.dumps({
                "executed_at": "2026-08-17T12:00:00+05:30", "mode": "paper", "execution_source": "algo", "strategy": "S/R Reversal",
                "signal_event": "reversal", "trading_symbol": "NIFTY-DEMO-PE", "quantity": 65,
                "entry_price": 90, "fill_price": 85, "pnl": -325, "exit_reason": "stop",
            }),
            json.dumps({
                "executed_at": "2026-08-17T13:00:00+05:30", "mode": "live", "execution_source": "manual", "strategy": "My Trades",
                "signal_event": "unknown", "trading_symbol": "NIFTY-DEMO-CE", "quantity": 65,
                "entry_price": 120, "fill_price": 126, "pnl": 390, "exit_reason": "manual_exit",
            }),
        ]),
        encoding="utf-8",
    )
    (input_dir / "minute.jsonl").write_text(
        "\n".join([
            json.dumps({"observed_at": "2026-08-17T09:15:00+05:30", "nifty_ltp": 24300, "synthetic_vwap": 24300, "constituent_volume_delta": 100000, "constituent_turnover": 10000000, "breadth": 0.5, "participation": 0.8, "cash_pressure": 0.1, "heavyweight_score": 0.1, "futures_score": 0.1, "option_score": 0.0, "combined_score": 0.1}),
            json.dumps({"observed_at": "2026-08-17T15:10:00+05:30", "nifty_ltp": 24350, "synthetic_vwap": 24320, "constituent_volume_delta": 200000, "constituent_turnover": 20000000, "breadth": 0.6, "participation": 0.9, "cash_pressure": 0.2, "heavyweight_score": 0.2, "futures_score": 0.3, "option_score": 0.1, "combined_score": 0.25}),
        ]),
        encoding="utf-8",
    )
    (input_dir / "watch.jsonl").write_text(
        json.dumps({"observed_at": "2026-08-17T11:00:00+05:30", "nifty_ltp": 24320, "nifty_move_1m_bps": 5, "nifty_move_5m_bps": 20, "nifty_move_15m_bps": 35, "cash_pressure": 0.6, "breadth": 0.7, "participation": 0.9, "heavyweight_score": 0.5, "futures_score": 0.5, "futures_oi_change_pct": 0.2, "option_score": 0.3, "option_oi_change_imbalance": 0.2, "vwap_distance_bps": 6, "constituent_volume_delta": 180000}),
        encoding="utf-8",
    )
    (input_dir / "metadata.json").write_text(
        json.dumps({
            "execution": {"mode": "paper", "live_armed": False},
            "paper_account_equity": 300000,
            "unresolved_live_orders": 0,
            "risk": {"kill_switch": False},
            "engine": {"state": "stopped"},
            "broker_audit": {"flat": True},
        }),
        encoding="utf-8",
    )

    result = subprocess.run(
        [sys.executable, "scripts/generate_daily_report.py", "--session-date", "2026-08-17", "--input-dir", str(input_dir), "--output-dir", str(output_dir)],
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    for name in (
        "pnl.png", "equity.png", "performance.png", "nifty.png",
        "daily-report-2026-08-17.html", "daily-report-2026-08-17.json", "daily-trades-2026-08-17.csv",
    ):
        assert (output_dir / name).exists(), name
    html = (output_dir / "daily-report-2026-08-17.html").read_text(encoding="utf-8")
    assert "Monthly P&amp;L" in html or "Monthly P&L" in html
    assert "S/R Breakout" in html
    assert "My Trades" in html
    assert "MY TRADES vs ALGO LIVE" in html
    assert "MARKET WATCH" in html
    csv_text = (output_dir / "daily-trades-2026-08-17.csv").read_text(encoding="utf-8")
    assert "execution_source" in csv_text
    assert "manual" in csv_text
