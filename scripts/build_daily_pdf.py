#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont

PAGE = (1240, 1754)
MARGIN = 72
INK = (23, 32, 51)
MUTED = (102, 112, 133)
LIGHT = (244, 247, 251)
BORDER = (222, 231, 241)


def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size=size)
    return ImageFont.load_default()


def _money(value: Any) -> str:
    try:
        return f"Rs {float(value):,.2f}"
    except (TypeError, ValueError):
        return "--"


def _pct(value: Any) -> str:
    try:
        return f"{float(value) * 100:.1f}%"
    except (TypeError, ValueError):
        return "--"


def _new_page(title: str, session: str, subtitle: str = "") -> tuple[Image.Image, ImageDraw.ImageDraw, int]:
    image = Image.new("RGB", PAGE, "white")
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((MARGIN, 54, PAGE[0] - MARGIN, 190), radius=22, fill=(7, 29, 53))
    draw.text((MARGIN + 28, 78), "Growing Trader", fill="white", font=_font(32, True))
    draw.text((MARGIN + 28, 128), title, fill=(220, 232, 246), font=_font(22, True))
    draw.text((PAGE[0] - MARGIN - 250, 82), session, fill="white", font=_font(20, True))
    if subtitle:
        draw.text((PAGE[0] - MARGIN - 370, 130), subtitle, fill=(199, 212, 228), font=_font(15))
    return image, draw, 230


def _section(draw: ImageDraw.ImageDraw, y: int, title: str) -> int:
    draw.text((MARGIN, y), title, fill=INK, font=_font(22, True))
    draw.line((MARGIN, y + 35, PAGE[0] - MARGIN, y + 35), fill=BORDER, width=2)
    return y + 55


def _kv(draw: ImageDraw.ImageDraw, x: int, y: int, label: str, value: str, width: int = 260) -> None:
    draw.rounded_rectangle((x, y, x + width, y + 108), radius=16, fill=LIGHT, outline=BORDER)
    draw.text((x + 15, y + 14), label, fill=MUTED, font=_font(13, True))
    draw.text((x + 15, y + 49), value, fill=INK, font=_font(22, True))


def _paste_chart(image: Image.Image, path: Path, box: tuple[int, int, int, int]) -> None:
    if not path.exists():
        return
    chart = Image.open(path).convert("RGB")
    chart.thumbnail((box[2] - box[0], box[3] - box[1]))
    x = box[0] + ((box[2] - box[0]) - chart.width) // 2
    y = box[1] + ((box[3] - box[1]) - chart.height) // 2
    image.paste(chart, (x, y))


def _load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except Exception:
        return {}


def _load_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def _broker_rows(metadata: dict[str, Any]) -> list[dict[str, Any]]:
    activity = metadata.get("broker_activity") if isinstance(metadata.get("broker_activity"), dict) else {}
    trades = activity.get("trades") if isinstance(activity.get("trades"), list) else []
    orders = activity.get("orders") if isinstance(activity.get("orders"), list) else []
    return [row for row in (trades or orders) if isinstance(row, dict)]


def _trade_table(draw: ImageDraw.ImageDraw, y: int, rows: list[dict[str, Any]], *, broker: bool = False) -> int:
    if not rows:
        draw.text((MARGIN, y), "No rows recorded for this session.", fill=MUTED, font=_font(16))
        return y + 36

    headers = ["Time", "Symbol", "Side", "Qty", "Price", "P&L / Status"]
    widths = [170, 300, 115, 90, 150, 250]
    x = MARGIN
    for header, width in zip(headers, widths):
        draw.rectangle((x, y, x + width, y + 42), fill=(235, 241, 248), outline=BORDER)
        draw.text((x + 8, y + 10), header, fill=INK, font=_font(13, True))
        x += width
    y += 42

    for row in rows[:22]:
        time_value = str(row.get("executed_at") or row.get("trade_timestamp") or row.get("exchange_time") or row.get("created_at") or "--")
        if "T" in time_value:
            time_value = time_value.split("T", 1)[1][:8]
        symbol = str(row.get("trading_symbol") or "--")
        side = str(row.get("transaction_type") or row.get("side") or "--")
        qty = str(row.get("quantity") or row.get("filled_quantity") or "--")
        price = row.get("fill_price", row.get("trade_price", row.get("price", row.get("average_fill_price"))))
        final = str(row.get("order_status") or row.get("status") or "") if broker else _money(row.get("pnl"))
        values = [time_value, symbol, side, qty, _money(price), final or "--"]
        x = MARGIN
        for value, width in zip(values, widths):
            draw.rectangle((x, y, x + width, y + 42), fill="white", outline=BORDER)
            clipped = value if len(value) <= 30 else value[:27] + "..."
            draw.text((x + 8, y + 10), clipped, fill=INK, font=_font(12))
            x += width
        y += 42
    return y + 18


def build(session: str, input_dir: Path, output_dir: Path) -> Path:
    summary = _load_json(output_dir / f"daily-report-{session}.json")
    metadata = _load_json(input_dir / "metadata.json")
    trades = _load_csv(output_dir / f"daily-trades-{session}.csv")
    broker_rows = _broker_rows(metadata)

    if not summary.get("primary"):
        image, draw, y = _new_page("Daily Report", session, "No market analysis")
        y = _section(draw, y, "Session status")
        draw.text((MARGIN, y), str(summary.get("message") or "No market analysis was collected."), fill=INK, font=_font(20))
        draw.text((MARGIN, y + 52), str(summary.get("last_error") or ""), fill=MUTED, font=_font(14))
        y = _section(draw, y + 120, "Groww broker activity")
        _trade_table(draw, y, broker_rows, broker=True)
        out = output_dir / f"growing-trader-daily-report-{session}.pdf"
        image.save(out, "PDF", resolution=150.0)
        return out

    primary = summary.get("primary", {})
    daily = primary.get("daily", {}) if isinstance(primary, dict) else {}
    monthly = primary.get("monthly", {}) if isinstance(primary, dict) else {}
    market = summary.get("market", {}) if isinstance(summary.get("market"), dict) else {}
    safety = summary.get("safety", {}) if isinstance(summary.get("safety"), dict) else {}
    mode = str(summary.get("primary_mode") or "paper").upper()

    pages: list[Image.Image] = []
    p1, d1, y = _new_page("Daily Trading Report", session, mode)
    y = _section(d1, y, "Performance summary")
    cards = [
        ("Day P&L", _money(daily.get("net_pnl"))),
        ("Month P&L", _money(monthly.get("net_pnl"))),
        ("Trades", str(daily.get("trades", 0))),
        ("Win rate", _pct(daily.get("win_rate"))),
    ]
    for idx, (label, value) in enumerate(cards):
        _kv(d1, MARGIN + idx * 275, y, label, value, 250)
    y += 142
    y = _section(d1, y, "P&L over time")
    _paste_chart(p1, output_dir / "pnl.png", (MARGIN, y, PAGE[0] - MARGIN, y + 430))
    y += 445
    y = _section(d1, y, "Market overview")
    market_values = [
        ("NIFTY close", str(market.get("close") or "--")),
        ("Volume", str(market.get("volume") or "--")),
        ("Breadth", _pct(market.get("breadth"))),
        ("Participation", _pct(market.get("participation"))),
    ]
    for idx, (label, value) in enumerate(market_values):
        _kv(d1, MARGIN + idx * 275, y, label, value, 250)
    pages.append(p1)

    p2, d2, y = _new_page("Charts & Market Watch", session, mode)
    y = _section(d2, y, "Equity / realized curve")
    _paste_chart(p2, output_dir / "equity.png", (MARGIN, y, 690, y + 390))
    _paste_chart(p2, output_dir / "performance.png", (700, y, PAGE[0] - MARGIN, y + 390))
    y += 410
    y = _section(d2, y, "NIFTY intraday")
    _paste_chart(p2, output_dir / "nifty.png", (MARGIN, y, PAGE[0] - MARGIN, y + 360))
    y += 380
    y = _section(d2, y, "Market Watch snapshot")
    watch = summary.get("market_watch") if isinstance(summary.get("market_watch"), dict) else {}
    watch_values = [
        ("Move", str(watch.get("move_bps") or "--") + " bps"),
        ("Cash pressure", str(watch.get("cash_pressure") or "--")),
        ("Heavyweights", str(watch.get("heavyweight_score") or "--")),
        ("Futures", str(watch.get("futures_score") or "--")),
    ]
    for idx, (label, value) in enumerate(watch_values):
        _kv(d2, MARGIN + idx * 275, y, label, value, 250)
    pages.append(p2)

    p3, d3, y = _new_page("Trades & Broker Activity", session, mode)
    y = _section(d3, y, "Growing Trader recorded trades")
    y = _trade_table(d3, y, trades, broker=False)
    y = _section(d3, min(y + 10, 1050), "Groww broker-side activity")
    y = _trade_table(d3, y, broker_rows, broker=True)
    if y < 1580:
        y = _section(d3, y + 10, "Safety")
        d3.text((MARGIN, y), f"Broker flat: {safety.get('broker_flat', '--')}   |   Unresolved LIVE orders: {safety.get('unresolved_live_orders', 0)}   |   LIVE armed: {safety.get('live_armed', False)}", fill=INK, font=_font(15))
    pages.append(p3)

    out = output_dir / f"growing-trader-daily-report-{session}.pdf"
    pages[0].save(out, "PDF", save_all=True, append_images=pages[1:], resolution=150.0)
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--session-date", required=True)
    parser.add_argument("--input-dir", default="report-input")
    parser.add_argument("--output-dir", default="daily-report")
    args = parser.parse_args()
    output = build(args.session_date, Path(args.input_dir), Path(args.output_dir))
    print(f"Generated {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
