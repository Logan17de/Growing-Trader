#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
from datetime import datetime
from html import escape
import json
import os
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen

PAUSE_MARKER = Path(__file__).resolve().parents[1] / ".trader-paused"


def _read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except Exception:
        return {}


def _broker_section(metadata: dict[str, Any]) -> str:
    activity = metadata.get("broker_activity") if isinstance(metadata.get("broker_activity"), dict) else {}
    trades = activity.get("trades") if isinstance(activity.get("trades"), list) else []
    orders = activity.get("orders") if isinstance(activity.get("orders"), list) else []
    rows = trades or orders
    if not rows:
        if activity.get("error"):
            return f"<div style='margin:18px 0;padding:16px;background:#fff7ed;border:1px solid #fed7aa;border-radius:12px'><strong>Groww broker activity</strong><p style='margin-bottom:0'>Sync unavailable: {escape(str(activity.get('error')))}</p></div>"
        return "<div style='margin:18px 0;padding:16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px'><strong>Groww broker activity</strong><p style='margin-bottom:0'>No broker-side orders/trade fills were returned for this session.</p></div>"

    body: list[str] = []
    for row in rows[:40]:
        if not isinstance(row, dict):
            continue
        symbol = escape(str(row.get("trading_symbol") or "—"))
        side = escape(str(row.get("transaction_type") or row.get("side") or "—"))
        qty = escape(str(row.get("quantity") or row.get("filled_quantity") or "—"))
        price = escape(str(row.get("trade_price") or row.get("fill_price") or row.get("price") or row.get("average_fill_price") or "—"))
        status = escape(str(row.get("order_status") or "filled" if trades else row.get("order_status") or "—"))
        when = escape(str(row.get("trade_timestamp") or row.get("exchange_time") or row.get("created_at") or "—"))
        body.append(f"<tr><td style='padding:7px;border-bottom:1px solid #edf1f6'>{when}</td><td style='padding:7px;border-bottom:1px solid #edf1f6;font-weight:700'>{symbol}</td><td style='padding:7px;border-bottom:1px solid #edf1f6'>{side}</td><td style='padding:7px;border-bottom:1px solid #edf1f6;text-align:right'>{qty}</td><td style='padding:7px;border-bottom:1px solid #edf1f6;text-align:right'>₹{price}</td><td style='padding:7px;border-bottom:1px solid #edf1f6'>{status}</td></tr>")
    return """
    <div style='margin:18px 0;padding:16px;background:white;border:1px solid #dfe7f1;border-radius:12px'>
      <div style='font-size:16px;font-weight:800;margin-bottom:10px'>Groww broker-side activity</div>
      <div style='font-size:12px;color:#667085;margin-bottom:10px'>Read-only reconciliation from Groww's day order/trade APIs. Kept separate from Growing Trader strategy P&L.</div>
      <table style='width:100%;border-collapse:collapse;font-size:11px'><tr style='background:#f6f9fc'><th>Time</th><th>Symbol</th><th>Side</th><th>Qty</th><th>Price</th><th>Status</th></tr>%s</table>
    </div>""" % "".join(body)


def _attachment(path: Path, content_type: str, *, content_id: str | None = None) -> dict[str, Any]:
    item: dict[str, Any] = {
        "content": base64.b64encode(path.read_bytes()).decode("ascii"),
        "filename": path.name,
        "content_type": content_type,
    }
    if content_id:
        item["content_id"] = content_id
    return item


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--session-date", required=True)
    parser.add_argument("--input-dir", default="report-input")
    parser.add_argument("--output-dir", default="daily-report")
    args = parser.parse_args()

    if PAUSE_MARKER.exists():
        print("Growing Trader is paused; daily report email skipped.")
        return 0

    key = os.environ.get("RESEND_API_KEY", "").strip()
    to = os.environ.get("TRADING_REPORT_TO", "").strip()
    sender = os.environ.get("TRADING_REPORT_FROM", "").strip()
    if not key or not to or not sender:
        raise RuntimeError("RESEND_API_KEY, TRADING_REPORT_TO and TRADING_REPORT_FROM are required")

    output_dir = Path(args.output_dir)
    input_dir = Path(args.input_dir)
    full_html = output_dir / f"daily-report-{args.session_date}.html"
    no_market_html = output_dir / f"no-market-analysis-{args.session_date}.html"
    html_path = full_html if full_html.exists() else no_market_html
    if not html_path.exists():
        raise RuntimeError("report HTML is missing")

    html = html_path.read_text(encoding="utf-8")
    metadata = _read_json(input_dir / "metadata.json")
    section = _broker_section(metadata)
    html = html.replace("</body>", section + "</body>") if "</body>" in html else html + section

    attachments: list[dict[str, Any]] = []
    for filename, content_id in (("pnl.png", "pnl-chart"), ("equity.png", "equity-chart"), ("performance.png", "performance-chart"), ("nifty.png", "nifty-chart")):
        path = output_dir / filename
        if path.exists():
            attachments.append(_attachment(path, "image/png", content_id=content_id))

    files = [
        (output_dir / f"growing-trader-daily-report-{args.session_date}.pdf", "application/pdf"),
        (output_dir / f"daily-trades-{args.session_date}.csv", "text/csv"),
        (output_dir / f"daily-report-{args.session_date}.json", "application/json"),
    ]
    for path, content_type in files:
        if path.exists():
            attachments.append(_attachment(path, content_type))

    date_label = datetime.strptime(args.session_date, "%Y-%m-%d").strftime("%d %b %Y")
    subject = f"📊 Your Trading Summary — {date_label}" if full_html.exists() else f"No market analysis today — {date_label}"
    payload = {"from": sender, "to": [to], "subject": subject, "html": html, "attachments": attachments}
    request = Request(
        "https://api.resend.com/emails",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Idempotency-Key": f"growing-trader-daily-report/{args.session_date}/{to.lower()}",
            "User-Agent": "Growing-Trader/1.0",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=45) as response:
            result = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Resend failed ({exc.code}): {detail}") from exc

    (output_dir / "delivery.json").write_text(json.dumps({"result": result}, indent=2), encoding="utf-8")
    print(f"Email sent: {result.get('id', 'unknown id')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
