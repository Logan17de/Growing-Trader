from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")
REPORT_RECIPIENT = "loganlogesh17@gmail.com"
PAUSE_MARKER = Path(__file__).resolve().parents[2] / ".trader-paused"


def _mail_config() -> tuple[str, str, str] | None:
    key = os.environ.get("RESEND_API_KEY", "").strip()
    sender = os.environ.get("TRADING_REPORT_FROM", "").strip()
    if not key or not sender:
        return None
    return key, REPORT_RECIPIENT, sender


def _record_delivery(subject: str, sent: bool, detail: str) -> None:
    """Persist best-effort mail delivery telemetry without affecting trading state."""
    try:
        from .control_plane import SupabaseControlPlane

        control = SupabaseControlPlane.from_env()
        kind = "waiting" if "waiting" in subject.lower() else "started"
        control.client.table("activity_events").insert({
            "observed_at": datetime.now(timezone.utc).isoformat(),
            "severity": "success" if sent else "warning",
            "component": "notifications",
            "event_type": f"{kind}_email_{'sent' if sent else 'failed'}",
            "title": f"Trading engine {kind} email {'sent' if sent else 'failed'}",
            "detail": detail[:2000],
        }).execute()
    except Exception:
        # Notifications and their telemetry must never alter trading state.
        pass


def _send(subject: str, html: str) -> dict[str, Any]:
    if PAUSE_MARKER.exists():
        return {"ok": True, "sent": False, "reason": "Growing Trader is paused"}

    config = _mail_config()
    if config is None:
        reason = "startup email configuration is incomplete"
        _record_delivery(subject, False, reason)
        return {"ok": False, "sent": False, "reason": reason}

    key, to, sender = config
    payload = json.dumps({
        "from": sender,
        "to": [to],
        "subject": subject,
        "html": html,
    }).encode()
    request = Request(
        "https://api.resend.com/emails",
        data=payload,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (compatible; GrowingTrader/1.0; +https://growing-trader.vercel.app)",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=20) as response:
            body = response.read().decode()
        _record_delivery(subject, True, body or "Resend accepted the message")
        return {"ok": True, "sent": True, "response": body}
    except HTTPError as exc:
        try:
            response_body = exc.read().decode("utf-8", errors="replace").strip()
        except Exception:
            response_body = ""
        reason = f"Resend HTTP {exc.code}: {response_body or exc.reason}; from={sender}; to={to}"
        _record_delivery(subject, False, reason)
        return {"ok": False, "sent": False, "reason": reason}
    except Exception as exc:  # Notifications must never change trading state.
        reason = f"{type(exc).__name__}: {exc}; from={sender}; to={to}"
        _record_delivery(subject, False, reason)
        return {"ok": False, "sent": False, "reason": reason}


def send_engine_started_email(result: dict[str, Any] | None = None) -> dict[str, Any]:
    """Send a best-effort email only after autonomous PAPER actually starts."""
    now = datetime.now(IST)
    attempts = None
    if isinstance(result, dict):
        raw_attempts = result.get("attempts")
        if isinstance(raw_attempts, int) and raw_attempts > 0:
            attempts = raw_attempts

    retry_note = (
        f"Groww authentication succeeded after {attempts} retry attempt{'s' if attempts != 1 else ''}."
        if attempts
        else "Groww authentication succeeded on the startup check."
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
    return _send("✅ Trading engine is started — Growing Trader", html)


def send_engine_waiting_email(error: str | None = None) -> dict[str, Any]:
    """Send one best-effort morning alert when autonomous PAPER cannot start yet."""
    now = datetime.now(IST)
    detail = (error or "Groww authentication/startup has not succeeded yet").strip()
    html = f"""
    <div style='font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#172033'>
      <h2>Trading engine is waiting</h2>
      <p>Oracle is online, but Groww authentication / PAPER startup has not succeeded yet.</p>
      <p><strong>No PAPER trading engine is running yet.</strong> Oracle will retry automatically every 10 minutes without sending repeated failure emails.</p>
      <p>As soon as Groww authentication succeeds, PAPER and Market Watch will start automatically and you will receive a separate startup-success email.</p>
      <div style='padding:12px;background:#f5f7fa;border-radius:8px;font-size:12px'>
        <strong>Checked:</strong> {now.strftime('%d %b %Y %H:%M:%S')} IST<br>
        <strong>Latest startup error:</strong> {detail}
      </div>
    </div>
    """
    return _send("⚠️ Trading engine is waiting — Growing Trader", html)
