#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import csv
from datetime import date, datetime, time
from email.utils import formatdate
from html import escape
import json
import math
import os
from pathlib import Path
import sys
from typing import Any, Iterable
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from nifty_engine.reporting import build_report_summary, cumulative_pnl_points, rows_for_session

IST = ZoneInfo("Asia/Kolkata")
BLUE = "#1967d2"
NAVY = "#071d35"
GREEN = "#16a765"
RED = "#e8453c"
MUTED = "#667085"
GRID = "#e7edf5"
INK = "#10254a"


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        value = json.loads(line)
        if isinstance(value, dict):
            rows.append(value)
    return rows


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists() or not path.read_text(encoding="utf-8").strip():
        return {}
    value = json.loads(path.read_text(encoding="utf-8"))
    return value if isinstance(value, dict) else {}


def _indian_group(value: int) -> str:
    sign = "-" if value < 0 else ""
    digits = str(abs(value))
    if len(digits) <= 3:
        return sign + digits
    tail = digits[-3:]
    head = digits[:-3]
    pairs: list[str] = []
    while head:
        pairs.append(head[-2:])
        head = head[:-2]
    return sign + ",".join(reversed(pairs)) + "," + tail


def money(value: Any, *, signed: bool = False) -> str:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return "—"
    if not math.isfinite(number):
        return "—"
    prefix = "+" if signed and number > 0 else ""
    return f"{prefix}₹{_indian_group(round(number))}"


def percent(value: Any, digits: int = 1) -> str:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return "—"
    if not math.isfinite(number):
        return "—"
    return f"{number * 100:.{digits}f}%"


def signed(value: Any, suffix: str = "", digits: int = 2) -> str:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return "—"
    if not math.isfinite(number):
        return "—"
    return f"{'+' if number > 0 else ''}{number:.{digits}f}{suffix}"


def compact_india(value: Any) -> str:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return "—"
    absolute = abs(number)
    if absolute >= 10_000_000:
        return f"{number / 10_000_000:.2f}Cr"
    if absolute >= 100_000:
        return f"{number / 100_000:.2f}L"
    if absolute >= 1_000:
        return f"{number / 1_000:.1f}K"
    return f"{number:.0f}"


def _parse_dt(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.astimezone(IST) if parsed.tzinfo else parsed.replace(tzinfo=IST)


def _font(size: int, bold: bool = False):
    from PIL import ImageFont

    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            return ImageFont.truetype(path, size=size)
    return ImageFont.load_default()


def _line_chart(
    points: list[tuple[datetime, float]],
    output: Path,
    *,
    title: str,
    baseline: float | None = 0.0,
    currency: bool = False,
    width: int = 960,
    height: int = 310,
) -> None:
    from PIL import Image, ImageDraw

    img = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(img)
    title_font = _font(20, True)
    axis_font = _font(12)
    value_font = _font(13, True)
    draw.text((22, 14), title, fill=INK, font=title_font)
    left, top, right, bottom = 86, 58, width - 26, height - 46
    draw.rectangle((left, top, right, bottom), outline="#dce4ee", width=1)

    if not points:
        draw.text((left + 24, top + 70), "No completed trades for this session", fill=MUTED, font=_font(17))
        img.save(output)
        return

    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    if baseline is not None:
        ys.append(baseline)
    y_min, y_max = min(ys), max(ys)
    if y_min == y_max:
        pad = max(abs(y_min) * 0.15, 1.0)
    else:
        pad = (y_max - y_min) * 0.15
    y_min -= pad
    y_max += pad
    start = datetime.combine(xs[0].date(), time(9, 15), tzinfo=IST)
    end = datetime.combine(xs[0].date(), time(15, 30), tzinfo=IST)
    total_seconds = max((end - start).total_seconds(), 1.0)

    def px(when: datetime) -> float:
        return left + max(0.0, min(1.0, (when - start).total_seconds() / total_seconds)) * (right - left)

    def py(value: float) -> float:
        return bottom - ((value - y_min) / max(y_max - y_min, 1e-9)) * (bottom - top)

    for index in range(5):
        ratio = index / 4
        y = top + ratio * (bottom - top)
        value = y_max - ratio * (y_max - y_min)
        draw.line((left, y, right, y), fill=GRID, width=1)
        label = money(value) if currency else f"{value:,.0f}"
        draw.text((8, y - 7), label, fill=MUTED, font=axis_font)

    ticks = ((9, 15), (10, 30), (12, 0), (13, 30), (15, 0))
    for hour, minute in ticks:
        when = datetime.combine(xs[0].date(), time(hour, minute), tzinfo=IST)
        x = px(when)
        draw.text((x - 18, bottom + 12), when.strftime("%H:%M"), fill=MUTED, font=axis_font)

    if baseline is not None and y_min <= baseline <= y_max:
        y = py(baseline)
        for x in range(left, right, 10):
            draw.line((x, y, min(x + 5, right), y), fill="#aab7c7", width=1)

    coords = [(px(when), py(value)) for when, value in points]
    if len(coords) == 1:
        draw.ellipse((coords[0][0] - 3, coords[0][1] - 3, coords[0][0] + 3, coords[0][1] + 3), fill=BLUE)
    else:
        draw.line(coords, fill=BLUE, width=4, joint="curve")
    last_value = points[-1][1]
    label = money(last_value, signed=True) if currency else f"{last_value:,.2f}"
    bbox = draw.textbbox((0, 0), label, font=value_font)
    box_w = bbox[2] - bbox[0] + 18
    box_h = bbox[3] - bbox[1] + 12
    x = min(coords[-1][0] + 8, right - box_w)
    y = max(top + 4, coords[-1][1] - box_h / 2)
    fill = GREEN if last_value >= (baseline or 0.0) else RED
    draw.rounded_rectangle((x, y, x + box_w, y + box_h), radius=6, fill=fill)
    draw.text((x + 9, y + 5), label, fill="white", font=value_font)
    img.save(output, optimize=True)


def _performance_chart(metrics: dict[str, Any], output: Path, width: int = 520, height: int = 320) -> None:
    from PIL import Image, ImageDraw

    img = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(img)
    draw.text((18, 14), "PERFORMANCE SNAPSHOT", fill=INK, font=_font(19, True))
    wins = int(metrics.get("wins") or 0)
    losses = int(metrics.get("losses") or 0)
    total = max(wins + losses, 1)
    win_ratio = wins / total
    box = (52, 72, 226, 246)
    draw.arc(box, start=-90, end=-90 + 360 * win_ratio, fill=GREEN, width=40)
    draw.arc(box, start=-90 + 360 * win_ratio, end=270, fill=RED, width=40)
    center = f"{win_ratio * 100:.0f}%"
    center_font = _font(22, True)
    bbox = draw.textbbox((0, 0), center, font=center_font)
    draw.text(((box[0] + box[2] - (bbox[2] - bbox[0])) / 2, (box[1] + box[3]) / 2 - 12), center, fill=INK, font=center_font)
    draw.text((270, 86), f"Profitable trades  {wins}", fill=GREEN, font=_font(14, True))
    draw.text((270, 116), f"Losing trades      {losses}", fill=RED, font=_font(14, True))
    rows = [
        ("Average Win", money(metrics.get("average_win"), signed=True), GREEN),
        ("Average Loss", money(metrics.get("average_loss"), signed=True), RED),
        ("Profit Factor", "∞" if metrics.get("profit_factor") == math.inf else (f"{metrics.get('profit_factor'):.2f}" if isinstance(metrics.get("profit_factor"), (int, float)) else "—"), INK),
        ("Max Drawdown", money(metrics.get("max_drawdown"), signed=True), RED),
        ("Expectancy", money(metrics.get("expectancy"), signed=True), GREEN if (metrics.get("expectancy") or 0) >= 0 else RED),
    ]
    y = 166
    for label, value, color in rows:
        draw.text((270, y), label, fill=MUTED, font=_font(12))
        draw.text((390, y - 1), value, fill=color, font=_font(13, True))
        y += 27
    img.save(output, optimize=True)


def _nifty_chart(minute_rows: list[dict[str, Any]], output: Path) -> None:
    points: list[tuple[datetime, float]] = []
    for row in sorted(minute_rows, key=lambda item: str(item.get("observed_at") or "")):
        when = _parse_dt(row.get("observed_at"))
        try:
            value = float(row.get("nifty_ltp"))
        except (TypeError, ValueError):
            continue
        if when and math.isfinite(value):
            points.append((when, value))
    _line_chart(points, output, title="NIFTY 50 · INTRADAY", baseline=None, currency=False, height=250)


def _write_trade_csv(rows: list[dict[str, Any]], path: Path) -> None:
    fields = ["executed_at", "mode", "strategy", "trading_symbol", "quantity", "entry_price", "fill_price", "pnl", "exit_reason", "broker_order_id"]
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def _metric_cell(label: str, value: str, detail: str = "", color: str = "#ffffff") -> str:
    return f"""<td style="padding:18px 14px;border-right:1px solid #35506d;text-align:center;vertical-align:top;min-width:110px">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.8px;color:#c7d4e4">{escape(label)}</div>
      <div style="font-size:22px;font-weight:800;color:{color};margin-top:8px;white-space:nowrap">{escape(value)}</div>
      <div style="font-size:11px;color:#dce5ef;margin-top:5px">{escape(detail)}</div>
    </td>"""


def _card(title: str, body: str) -> str:
    return f"<div style='border:1px solid #dfe7f1;border-radius:12px;padding:18px;background:#fff;margin:0 0 16px'><div style='font-size:15px;font-weight:800;color:{INK};margin-bottom:12px'>{escape(title)}</div>{body}</div>"


def _strategy_table(summary: dict[str, Any]) -> str:
    rows: list[str] = []
    for mode in ("live", "paper"):
        strategies = summary["modes"][mode]["strategies"]
        for name in ("S/R Breakout", "S/R Reversal", "Other / Unattributed"):
            metrics = strategies.get(name)
            if not metrics or not metrics.get("trades"):
                continue
            pnl = float(metrics.get("net_pnl") or 0.0)
            rows.append(
                "<tr>"
                f"<td style='padding:10px;border-bottom:1px solid #edf1f6'><strong>{escape(name)}</strong><br><span style='color:{MUTED};font-size:11px'>{mode.upper()}</span></td>"
                f"<td style='padding:10px;border-bottom:1px solid #edf1f6;text-align:right'>{metrics['trades']}</td>"
                f"<td style='padding:10px;border-bottom:1px solid #edf1f6;text-align:right'>{percent(metrics.get('win_rate'))}</td>"
                f"<td style='padding:10px;border-bottom:1px solid #edf1f6;text-align:right;color:{GREEN if pnl >= 0 else RED};font-weight:800'>{money(pnl, signed=True)}</td>"
                f"<td style='padding:10px;border-bottom:1px solid #edf1f6;text-align:right'>{money(metrics.get('expectancy'), signed=True)}</td>"
                "</tr>"
            )
    if not rows:
        return f"<div style='color:{MUTED}'>No closed trades to attribute to a strategy today.</div>"
    header = "<tr style='background:#f6f9fc;color:#667085;font-size:11px;text-transform:uppercase'><th style='padding:10px;text-align:left'>Strategy</th><th style='padding:10px;text-align:right'>Trades</th><th style='padding:10px;text-align:right'>Win rate</th><th style='padding:10px;text-align:right'>Net P&L</th><th style='padding:10px;text-align:right'>Expectancy</th></tr>"
    return f"<table role='presentation' style='width:100%;border-collapse:collapse;font-size:13px'>{header}{''.join(rows)}</table>"


def _mode_comparison(summary: dict[str, Any]) -> str:
    rows = []
    for mode in ("live", "paper"):
        daily = summary["modes"][mode]["daily"]
        monthly = summary["modes"][mode]["monthly"]
        pnl = float(daily.get("net_pnl") or 0.0)
        rows.append(
            f"<tr><td style='padding:9px 12px;border-bottom:1px solid #edf1f6;font-weight:700'>{mode.upper()}</td>"
            f"<td style='padding:9px 12px;border-bottom:1px solid #edf1f6;text-align:right'>{daily.get('trades',0)}</td>"
            f"<td style='padding:9px 12px;border-bottom:1px solid #edf1f6;text-align:right'>{percent(daily.get('win_rate'))}</td>"
            f"<td style='padding:9px 12px;border-bottom:1px solid #edf1f6;text-align:right;color:{GREEN if pnl>=0 else RED};font-weight:800'>{money(pnl,signed=True)}</td>"
            f"<td style='padding:9px 12px;border-bottom:1px solid #edf1f6;text-align:right'>{money(monthly.get('net_pnl'),signed=True)}</td></tr>"
        )
    return "<table role='presentation' style='width:100%;border-collapse:collapse;font-size:13px'><tr style='background:#f6f9fc;color:#667085;font-size:11px;text-transform:uppercase'><th style='padding:9px 12px;text-align:left'>Mode</th><th style='padding:9px 12px;text-align:right'>Trades</th><th style='padding:9px 12px;text-align:right'>Win rate</th><th style='padding:9px 12px;text-align:right'>Today</th><th style='padding:9px 12px;text-align:right'>Month</th></tr>" + "".join(rows) + "</table>"


def build_html(summary: dict[str, Any], recipient_name: str) -> str:
    primary = summary["primary"]
    daily = primary["daily"]
    monthly = primary["monthly"]
    market = summary["market"]
    watch = summary.get("market_watch")
    safety = summary["safety"]
    day_pnl = float(daily.get("net_pnl") or 0.0)
    month_pnl = float(monthly.get("net_pnl") or 0.0)
    day_color = GREEN if day_pnl >= 0 else RED
    month_color = GREEN if month_pnl >= 0 else RED
    mode = summary["primary_mode"].upper()
    broker_flat = safety.get("broker_flat")
    broker_text = "Confirmed flat" if broker_flat is True else "Not flat" if broker_flat is False else "No audit result"
    broker_color = GREEN if broker_flat is True else RED if broker_flat is False else "#c58a00"
    market_move = float(market.get("change_points") or 0.0)
    market_color = GREEN if market_move >= 0 else RED
    starting = money(summary.get("starting_balance"))
    ending = money(summary.get("ending_balance"))
    balance_detail = "Paper equity baseline" if summary["primary_mode"] == "paper" else "LIVE broker equity not persisted"

    watch_body = f"<div style='color:{MUTED}'>No retrospective Market Watch move label is available for this session yet.</div>"
    if isinstance(watch, dict):
        move = float(watch.get("move_bps") or 0.0)
        watch_body = f"""
        <div style="font-size:14px;color:{INK};margin-bottom:10px"><strong>Largest labeled move:</strong> <span style="color:{GREEN if move>=0 else RED};font-weight:800">{signed(move,' bps')}</span> over {escape(str(watch.get('horizon') or '—'))}, observed around {escape((_parse_dt(watch.get('observed_at')) or datetime.now(IST)).strftime('%H:%M'))}</div>
        <table role="presentation" style="width:100%;border-collapse:collapse;font-size:12px">
          <tr><td style="padding:7px;color:{MUTED}">Cash pressure</td><td style="padding:7px;font-weight:700">{signed(watch.get('cash_pressure'))}</td><td style="padding:7px;color:{MUTED}">Breadth</td><td style="padding:7px;font-weight:700">{signed(watch.get('breadth'))}</td></tr>
          <tr><td style="padding:7px;color:{MUTED}">Heavyweights</td><td style="padding:7px;font-weight:700">{signed(watch.get('heavyweight_score'))}</td><td style="padding:7px;color:{MUTED}">Participation</td><td style="padding:7px;font-weight:700">{percent(watch.get('participation'))}</td></tr>
          <tr><td style="padding:7px;color:{MUTED}">Futures score</td><td style="padding:7px;font-weight:700">{signed(watch.get('futures_score'))}</td><td style="padding:7px;color:{MUTED}">Futures OI change</td><td style="padding:7px;font-weight:700">{signed(watch.get('futures_oi_change_pct'),'%')}</td></tr>
          <tr><td style="padding:7px;color:{MUTED}">Options score</td><td style="padding:7px;font-weight:700">{signed(watch.get('option_score'))}</td><td style="padding:7px;color:{MUTED}">Options OI imbalance</td><td style="padding:7px;font-weight:700">{signed(watch.get('option_oi_change_imbalance'))}</td></tr>
          <tr><td style="padding:7px;color:{MUTED}">VWAP distance</td><td style="padding:7px;font-weight:700">{signed(watch.get('vwap_distance_bps'),' bps')}</td><td style="padding:7px;color:{MUTED}">50-stock volume</td><td style="padding:7px;font-weight:700">{compact_india(watch.get('constituent_volume_delta'))}</td></tr>
        </table>"""

    summary_cells = "".join([
        _metric_cell("Net P&L", money(day_pnl, signed=True), mode, day_color),
        _metric_cell("Monthly P&L", money(month_pnl, signed=True), datetime.fromisoformat(summary["session_date"]).strftime("%b %Y"), month_color),
        _metric_cell("Total Trades", str(daily.get("trades", 0)), f"{daily.get('wins',0)} wins / {daily.get('losses',0)} losses"),
        _metric_cell("Win Rate", percent(daily.get("win_rate")), "Closed trades"),
        _metric_cell("Starting Balance", starting, balance_detail),
        _metric_cell("Ending Balance", ending, balance_detail),
        _metric_cell("Best Trade", money(daily.get("best_trade"), signed=True), "Realized", GREEN),
    ])
    html = f"""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Growing Trader Daily Report</title></head>
    <body style="margin:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:{INK}">
    <div style="max-width:1080px;margin:0 auto;background:white;padding:26px 28px 34px">
      <table role="presentation" style="width:100%;border-collapse:collapse;border-bottom:1px solid #e5eaf1;padding-bottom:16px"><tr>
        <td><div style="font-size:23px;font-weight:800;color:{INK}">📊 Growing Trader</div><div style="font-size:12px;color:{MUTED};margin-top:4px">Automated trading desk report · {escape(mode)}</div></td>
        <td style="text-align:right;color:{INK};font-size:13px">{datetime.now(IST).strftime('%I:%M %p')} (IST)<br>{datetime.fromisoformat(summary['session_date']).strftime('%d %b %Y')}</td>
      </tr></table>
      <h1 style="font-size:24px;margin:24px 0 8px;color:{INK}">Your Trading Summary — {datetime.fromisoformat(summary['session_date']).strftime('%d %b %Y')}</h1>
      <p style="font-size:14px;margin:0 0 18px;color:#34445c">Hi {escape(recipient_name)},<br>Here is your daily trading summary, strategy performance, market overview, and Market Watch research snapshot.</p>

      <div style="border-radius:14px;overflow:hidden;background:{NAVY};margin-bottom:18px"><div style="padding:14px 16px 0;color:white;font-size:13px;font-weight:800">TODAY'S SUMMARY · {escape(mode)}</div><div style="overflow-x:auto"><table role="presentation" style="width:100%;border-collapse:collapse;margin-top:4px"><tr>{summary_cells}</tr></table></div></div>

      {_card('P&L OVER TIME', '<img src="cid:pnl-chart" alt="Intraday P&L chart" style="width:100%;height:auto;display:block">')}

      <table role="presentation" style="width:100%;border-collapse:collapse"><tr><td style="width:55%;vertical-align:top;padding-right:8px">{_card('EQUITY / REALIZED CURVE', '<img src="cid:equity-chart" alt="Equity curve" style="width:100%;height:auto;display:block">')}</td><td style="width:45%;vertical-align:top;padding-left:8px">{_card('PERFORMANCE SNAPSHOT', '<img src="cid:performance-chart" alt="Performance snapshot" style="width:100%;height:auto;display:block">')}</td></tr></table>

      {_card('PAPER / LIVE PERFORMANCE', _mode_comparison(summary))}
      {_card('STRATEGY PERFORMANCE', _strategy_table(summary))}

      {_card('MARKET OVERVIEW', f'<img src="cid:nifty-chart" alt="NIFTY intraday chart" style="width:100%;height:auto;display:block"><table role="presentation" style="width:100%;border-collapse:collapse;margin-top:8px;font-size:12px"><tr><td style="padding:8px"><strong>NIFTY close</strong><br><span style="font-size:22px;font-weight:800">{market.get("close") or "—"}</span><br><span style="color:{market_color};font-weight:700">{signed(market.get("change_points")," pts")} ({percent(market.get("change_pct"))})</span></td><td style="padding:8px"><strong>50-stock volume</strong><br><span style="font-size:18px;font-weight:800">{compact_india(market.get("volume"))} shares</span><br><span style="color:{MUTED}">Constituent-derived</span></td><td style="padding:8px"><strong>Turnover</strong><br><span style="font-size:18px;font-weight:800">{money(market.get("turnover"))}</span></td><td style="padding:8px"><strong>Breadth / Participation</strong><br><span style="font-size:18px;font-weight:800">{percent(market.get("breadth"))} / {percent(market.get("participation"))}</span></td></tr><tr><td style="padding:8px"><strong>Synthetic VWAP</strong><br>{market.get("synthetic_vwap") or "—"}</td><td style="padding:8px"><strong>Cash pressure</strong><br>{signed(market.get("cash_pressure"))}</td><td style="padding:8px"><strong>Futures score</strong><br>{signed(market.get("futures_score"))}</td><td style="padding:8px"><strong>Options / Combined</strong><br>{signed(market.get("option_score"))} / {signed(market.get("combined_score"))}</td></tr></table>')}

      {_card('🔬 MARKET WATCH', watch_body)}

      {_card('BROKER & SYSTEM SAFETY', f'<table role="presentation" style="width:100%;border-collapse:collapse;font-size:13px"><tr><td style="padding:9px;color:{MUTED}">Groww NIFTY F&O positions</td><td style="padding:9px;text-align:right;color:{broker_color};font-weight:800">{escape(broker_text)}</td></tr><tr><td style="padding:9px;color:{MUTED}">Unresolved LIVE orders</td><td style="padding:9px;text-align:right;font-weight:800">{safety.get("unresolved_live_orders",0)}</td></tr><tr><td style="padding:9px;color:{MUTED}">LIVE armed</td><td style="padding:9px;text-align:right;font-weight:800">{"YES" if safety.get("live_armed") else "No"}</td></tr><tr><td style="padding:9px;color:{MUTED}">Kill switch</td><td style="padding:9px;text-align:right;font-weight:800">{"ACTIVE" if safety.get("kill_switch") else "Clear"}</td></tr><tr><td style="padding:9px;color:{MUTED}">Last engine state</td><td style="padding:9px;text-align:right;font-weight:800">{escape(str(safety.get("engine_state") or "—"))}</td></tr></table>')}

      <div style="border-radius:12px;background:#eef6ff;padding:15px 18px;margin-top:12px"><strong style="color:{BLUE}">DAY RESULT</strong><div style="margin-top:6px;font-size:13px">{escape(mode)} day P&L: <strong style="color:{day_color}">{money(day_pnl,signed=True)}</strong> · Monthly P&L: <strong style="color:{month_color}">{money(month_pnl,signed=True)}</strong> · Broker audit: <strong style="color:{broker_color}">{escape(broker_text)}</strong></div></div>
      <p style="text-align:center;color:#8a98aa;font-size:11px;margin:24px 0 0">This is an automated report from Growing Trader. PAPER and LIVE results are kept separate. NIFTY volume is constituent-derived.</p>
    </div></body></html>"""
    return html


def send_resend(*, html: str, subject: str, to: str, from_address: str, output_dir: Path, session_date: str) -> dict[str, Any]:
    api_key = os.environ.get("RESEND_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("RESEND_API_KEY is not configured")
    attachments: list[dict[str, Any]] = []
    inline = [
        ("pnl.png", "pnl-chart"),
        ("equity.png", "equity-chart"),
        ("performance.png", "performance-chart"),
        ("nifty.png", "nifty-chart"),
    ]
    for filename, content_id in inline:
        content = base64.b64encode((output_dir / filename).read_bytes()).decode("ascii")
        attachments.append({"content": content, "filename": filename, "content_id": content_id, "content_type": "image/png"})
    for filename, content_type in ((f"daily-trades-{session_date}.csv", "text/csv"), (f"daily-report-{session_date}.json", "application/json")):
        path = output_dir / filename
        if path.exists():
            attachments.append({"content": base64.b64encode(path.read_bytes()).decode("ascii"), "filename": filename, "content_type": content_type})
    payload = {"from": from_address, "to": [to], "subject": subject, "html": html, "attachments": attachments}
    request = Request(
        "https://api.resend.com/emails",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Idempotency-Key": f"growing-trader-daily-report/{session_date}/{to.lower()}",
            "User-Agent": "Growing-Trader/1.0",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Resend failed ({exc.code}): {detail}") from exc


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate the Growing Trader visual daily email report")
    parser.add_argument("--session-date", required=True, help="IST session date YYYY-MM-DD")
    parser.add_argument("--input-dir", default="report-input")
    parser.add_argument("--output-dir", default="daily-report")
    parser.add_argument("--send", action="store_true")
    args = parser.parse_args()

    session = date.fromisoformat(args.session_date)
    input_dir = Path(args.input_dir)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    trades = read_jsonl(input_dir / "trades.jsonl")
    minute = read_jsonl(input_dir / "minute.jsonl")
    watch = read_jsonl(input_dir / "watch.jsonl")
    metadata = read_json(input_dir / "metadata.json")
    summary = build_report_summary(session_date=session, trade_rows=trades, minute_rows=minute, watch_rows=watch, metadata=metadata)
    primary_rows = rows_for_session(trades, session, summary["primary_mode"])
    pnl_points = cumulative_pnl_points(primary_rows)
    starting = summary.get("starting_balance")
    equity_points = [(when, (float(starting) if starting is not None else 0.0) + pnl) for when, pnl in pnl_points]
    _line_chart(pnl_points, output_dir / "pnl.png", title=f"P&L OVER TIME · {summary['primary_mode'].upper()}", baseline=0.0, currency=True)
    _line_chart(equity_points, output_dir / "equity.png", title="EQUITY CURVE" if starting is not None else "REALIZED P&L CURVE · LIVE", baseline=starting if starting is not None else 0.0, currency=True, width=620, height=320)
    _performance_chart(summary["primary"]["daily"], output_dir / "performance.png")
    _nifty_chart(minute, output_dir / "nifty.png")
    report_json = output_dir / f"daily-report-{args.session_date}.json"
    report_json.write_text(json.dumps(summary, indent=2, default=str), encoding="utf-8")
    _write_trade_csv(rows_for_session(trades, session), output_dir / f"daily-trades-{args.session_date}.csv")
    recipient_name = os.environ.get("TRADING_REPORT_NAME", "Logan").strip() or "Logan"
    html = build_html(summary, recipient_name)
    html_path = output_dir / f"daily-report-{args.session_date}.html"
    html_path.write_text(html, encoding="utf-8")

    print(f"Generated {html_path}")
    print(f"Primary mode: {summary['primary_mode']}; daily P&L: {summary['primary']['daily']['net_pnl']}; monthly P&L: {summary['primary']['monthly']['net_pnl']}")
    if args.send:
        to = os.environ.get("TRADING_REPORT_TO", "").strip()
        from_address = os.environ.get("TRADING_REPORT_FROM", "").strip()
        if not to or not from_address:
            raise RuntimeError("TRADING_REPORT_TO and TRADING_REPORT_FROM are required when --send is used")
        result = send_resend(
            html=html,
            subject=f"📊 Your Trading Summary — {session.strftime('%d %b %Y')}",
            to=to,
            from_address=from_address,
            output_dir=output_dir,
            session_date=args.session_date,
        )
        (output_dir / "delivery.json").write_text(json.dumps({"sent_at": formatdate(localtime=False), "result": result}, indent=2), encoding="utf-8")
        print(f"Email sent: {result.get('id', 'unknown id')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
