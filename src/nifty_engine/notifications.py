from __future__ import annotations

from datetime import datetime
import json
import os
from typing import Any
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")


def send_engine_started_email(result: dict[str, Any] | None = None) -> dict[str, Any]:
    """Send a best-effort startup email after autonomous PAPER actually starts.

    Missing mail configuration or delivery failure never changes engine state.
    """
    key = os.environ.get("RESEND_API_KEY", "").strip()
    to = os.environ.get("TRADING_REPORT_TO", "").strip()
    sender = os.environ.get("TRADING_REPORT_FROM", "").strip()
    if not key or not to or not sender:
        return {"ok": False, "sent": False, "reason": "startup email configuration is incomplete"}

    now = datetime.now(IST)
    attempts = None
    if isinstance(result, dict):
        raw_attempts = result.get("attempts")
        if isinstance(raw_attempts, int) and raw_attempts > 0:
            attempts = raw_attempts

    retry_note = (
        f"Groww authentication succeeded after {attempts} retry attempt{'s' if attempts != 1 else ''}."
        if attempts
        else "Groww authentication succeeded on the scheduled startup check."
    )
    html = f"""
    <div style='font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#172033'>
      <h2>Trading engine is started</h2>
      <p>Growing Trader is now running the autonomous <strong>PAPER</strong> trading engine.</p>
      <p>{retry_note}</p>
      <p><strong>Market Watch is active</strong> and can collect the market session automatically.</p>
      <div style='padding:12px;background:#f5f7fa;border-radius:8px;font-size:12px'>
        <strong>Started:</strong> {now.strftime('%d %b %Y %H:%M:%S')} IST<br>
        <strong>Execution mode:</strong> PAPER<br>
        <strong>Groww:</strong> authenticated
      </div>
    </div>
    """
    payload = json.dumps({
        "from": sender,
        "to": [to],
        "subject": "✅ Trading engine is started — Growing Trader",
        "html": html,
    }).encode()
    request = Request(
        "https://api.resend.com/emails",
        data=payload,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=20) as response:
            body = response.read().decode()
        return {"ok": True, "sent": True, "response": body}
    except Exception as exc:  # Notification failure must never stop the trading engine.
        return {"ok": False, "sent": False, "reason": f"{type(exc).__name__}: {exc}"}
