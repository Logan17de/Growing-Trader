from __future__ import annotations

from base64 import urlsafe_b64decode
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import logging
import os
import socket
import time
from typing import Any, Callable
from zoneinfo import ZoneInfo

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

logger = logging.getLogger(__name__)


def _decode_base64url(value: str) -> bytes:
    return urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _json_safe(value: Any) -> Any:
    return json.loads(json.dumps(value, default=str))


def _error_details(exc: Exception) -> dict[str, Any]:
    details: dict[str, Any] = {
        "ok": False,
        "exception": type(exc).__name__,
        "message": str(exc),
    }
    for attr in ("code", "msg", "status_code", "status"):
        value = getattr(exc, attr, None)
        if value not in (None, ""):
            details[attr] = _json_safe(value)
    response = getattr(exc, "response", None)
    response_status = getattr(response, "status_code", None)
    if response_status is not None:
        details["http_status"] = response_status
    return details


def _summarize_private_payload(value: Any) -> dict[str, Any]:
    safe = _json_safe(value)
    if isinstance(safe, list):
        return {"type": "list", "count": len(safe)}
    if isinstance(safe, dict):
        summary: dict[str, Any] = {"type": "object", "keys": list(safe.keys())[:20]}
        for key in ("holdings", "positions", "data", "orders", "trades"):
            nested = safe.get(key)
            if isinstance(nested, list):
                summary[f"{key}_count"] = len(nested)
        return summary
    return {"type": type(safe).__name__}


def _summarize_option_chain(value: Any) -> dict[str, Any]:
    safe = _json_safe(value)
    if not isinstance(safe, dict):
        return {"type": type(safe).__name__}
    strikes = safe.get("strikes")
    strike_keys = list(strikes.keys()) if isinstance(strikes, dict) else []
    return {
        "underlying_ltp": safe.get("underlying_ltp"),
        "strike_count": len(strike_keys),
        "sample_strikes": strike_keys[:5],
    }


def _probe(
    call: Callable[[], Any],
    *,
    summarize: Callable[[Any], Any] | None = None,
) -> dict[str, Any]:
    try:
        value = call()
        return {
            "ok": True,
            "value": _json_safe(summarize(value) if summarize else value),
        }
    except Exception as exc:
        return _error_details(exc)


def _is_forbidden(probe: dict[str, Any]) -> bool:
    code = str(probe.get("code", "")).upper()
    message = str(probe.get("message", "")).lower()
    status = probe.get("http_status", probe.get("status_code"))
    return code == "GA005" or "forbidden" in message or status == 403


def _classify_market_diagnostic(
    live_data: dict[str, dict[str, Any]],
    non_trading: dict[str, dict[str, Any]],
) -> tuple[str, str]:
    live_results = list(live_data.values())
    successes = sum(1 for item in live_results if item.get("ok"))
    forbidden = sum(1 for item in live_results if _is_forbidden(item))
    non_trading_successes = sum(1 for item in non_trading.values() if item.get("ok"))

    if live_results and successes == len(live_results):
        return "ok", "All tested Groww Live Data endpoints are available."
    if successes:
        return (
            "partial",
            "Groww Live Data is partially available. Review the per-endpoint results to isolate the denied instrument or API family.",
        )
    if live_results and forbidden == len(live_results):
        if non_trading_successes:
            return (
                "forbidden",
                "Authentication and non-trading account APIs work, but every tested Live Data endpoint is forbidden. This pattern points to Groww Live Data authorization/subscription or daily API approval rather than a bad symbol. Groww documents static-IP whitelisting for order placement, so this diagnostic does not by itself implicate the registered IP.",
            )
        return (
            "forbidden",
            "Every tested Groww Live Data endpoint is forbidden and non-trading probes also failed. Check API subscription, daily API approval, account authorization, and the returned Groww error codes.",
        )
    return (
        "error",
        "No tested Groww Live Data endpoint succeeded. Review the captured exception classes, Groww codes and HTTP statuses below.",
    )


class CredentialCipher:
    def __init__(self, key_b64: str) -> None:
        import base64

        try:
            key = base64.b64decode(key_b64, validate=True)
        except Exception as exc:
            raise ValueError("BROKER_CREDENTIAL_ENCRYPTION_KEY must be valid base64") from exc
        if len(key) != 32:
            raise ValueError("BROKER_CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes")
        self._cipher = AESGCM(key)

    def decrypt(self, packed: str) -> str:
        try:
            version, iv_text, ciphertext_text = packed.split(".", 2)
        except ValueError as exc:
            raise ValueError("invalid encrypted credential format") from exc
        if version != "v1":
            raise ValueError("unsupported encrypted credential version")
        plaintext = self._cipher.decrypt(
            _decode_base64url(iv_text), _decode_base64url(ciphertext_text), None
        )
        return plaintext.decode("utf-8")


@dataclass(frozen=True, slots=True)
class BrokerCredentials:
    api_key: str
    api_secret: str


class SupabaseControlPlane:
    def __init__(self, url: str, service_role_key: str, encryption_key: str) -> None:
        from supabase import create_client

        self.client = create_client(url, service_role_key)
        self.cipher = CredentialCipher(encryption_key)

    @classmethod
    def from_env(cls) -> "SupabaseControlPlane":
        url = os.getenv("SUPABASE_URL")
        service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        encryption_key = os.getenv("BROKER_CREDENTIAL_ENCRYPTION_KEY")
        if not url or not service_key or not encryption_key:
            raise RuntimeError(
                "SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and "
                "BROKER_CREDENTIAL_ENCRYPTION_KEY are required"
            )
        return cls(url, service_key, encryption_key)

    def load_groww_credentials(self) -> BrokerCredentials:
        response = (
            self.client.table("broker_credentials")
            .select("api_key_ciphertext,api_secret_ciphertext")
            .eq("broker", "groww")
            .maybe_single()
            .execute()
        )
        row = response.data
        if not row:
            raise RuntimeError("Groww credentials are not configured in the dashboard")
        return BrokerCredentials(
            api_key=self.cipher.decrypt(str(row["api_key_ciphertext"])),
            api_secret=self.cipher.decrypt(str(row["api_secret_ciphertext"])),
        )

    def claim_command(self, worker_id: str) -> dict[str, Any] | None:
        response = self.client.rpc(
            "claim_engine_command", {"p_worker_id": worker_id}
        ).execute()
        rows = response.data or []
        return dict(rows[0]) if rows else None

    def complete_command(
        self,
        command_id: str,
        *,
        result: dict[str, Any] | None = None,
        error: str | None = None,
    ) -> None:
        values: dict[str, Any] = {
            "status": "failed" if error else "completed",
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "result": result,
            "error": error,
        }
        self.client.table("engine_commands").update(values).eq("id", command_id).execute()

    def heartbeat(
        self,
        *,
        worker_id: str,
        state: str,
        groww_authenticated: bool = False,
        market_data_status: str = "unknown",
        market_data: dict[str, Any] | None = None,
        last_error: str | None = None,
    ) -> None:
        now = datetime.now(timezone.utc).isoformat()
        self.client.table("engine_status").upsert(
            {
                "worker_id": worker_id,
                "state": state,
                "execution_mode": "paper",
                "last_heartbeat": now,
                "groww_authenticated": groww_authenticated,
                "market_data_status": market_data_status,
                "market_data": market_data,
                "last_error": last_error,
                "metadata": {"hostname": socket.gethostname(), "pid": os.getpid()},
                "updated_at": now,
            },
            on_conflict="worker_id",
        ).execute()


class OracleControlAgent:
    """Outbound-only Oracle agent for Vercel/Supabase dashboard commands."""

    def __init__(
        self,
        control: SupabaseControlPlane,
        *,
        worker_id: str = "oracle-primary",
        poll_seconds: float = 2.0,
    ) -> None:
        if poll_seconds <= 0:
            raise ValueError("poll_seconds must be positive")
        self.control = control
        self.worker_id = worker_id
        self.poll_seconds = poll_seconds
        self.state = "idle"
        self.groww_authenticated = False
        self.market_data_status = "unknown"
        self.market_data: dict[str, Any] | None = None
        self.last_error: str | None = None

    def _groww_client(self) -> tuple[Any, dict[str, Any]]:
        from growwapi import GrowwAPI

        credentials = self.control.load_groww_credentials()
        token = GrowwAPI.get_access_token(
            api_key=credentials.api_key,
            secret=credentials.api_secret,
        )
        groww = GrowwAPI(token)
        profile = dict(groww.get_user_profile())
        safe_profile = {
            "nse_enabled": bool(profile.get("nse_enabled")),
            "bse_enabled": bool(profile.get("bse_enabled")),
            "ddpi_enabled": bool(profile.get("ddpi_enabled")),
            "active_segments": profile.get("active_segments", []),
        }
        return groww, safe_profile

    def _test_auth(self) -> dict[str, Any]:
        _groww, profile = self._groww_client()
        self.groww_authenticated = True
        self.last_error = None
        return {"ok": True, "profile": profile}

    def _nearest_nifty_expiry(self, groww: Any) -> tuple[dict[str, Any], str | None]:
        today = datetime.now(ZoneInfo("Asia/Kolkata")).date()
        months: list[tuple[int, int]] = [(today.year, today.month)]
        if today.month == 12:
            months.append((today.year + 1, 1))
        else:
            months.append((today.year, today.month + 1))

        attempts: list[dict[str, Any]] = []
        for year, month in months:
            probe = _probe(
                lambda year=year, month=month: groww.get_expiries(
                    exchange=groww.EXCHANGE_NSE,
                    underlying_symbol="NIFTY",
                    year=year,
                    month=month,
                )
            )
            attempts.append({"year": year, "month": month, **probe})
            if not probe.get("ok"):
                continue
            value = probe.get("value")
            expiries = value.get("expiries", []) if isinstance(value, dict) else []
            future = sorted(
                str(item) for item in expiries if str(item) >= today.isoformat()
            )
            if future:
                return {"ok": True, "expiry": future[0], "attempts": attempts}, future[0]

        return {
            "ok": False,
            "message": "Could not resolve a current NIFTY expiry; option-chain probe skipped.",
            "attempts": attempts,
        }, None

    def _test_market_data(self) -> dict[str, Any]:
        groww, profile = self._groww_client()
        self.groww_authenticated = True

        non_trading = {
            "holdings": _probe(
                groww.get_holdings_for_user,
                summarize=_summarize_private_payload,
            ),
            "positions": _probe(
                groww.get_positions_for_user,
                summarize=_summarize_private_payload,
            ),
        }
        live_data = {
            "reliance_ltp": _probe(
                lambda: groww.get_ltp(
                    segment=groww.SEGMENT_CASH,
                    exchange_trading_symbols="NSE_RELIANCE",
                )
            ),
            "nifty_ltp": _probe(
                lambda: groww.get_ltp(
                    segment=groww.SEGMENT_CASH,
                    exchange_trading_symbols="NSE_NIFTY",
                )
            ),
            "nifty_quote": _probe(
                lambda: groww.get_quote(
                    exchange=groww.EXCHANGE_NSE,
                    segment=groww.SEGMENT_CASH,
                    trading_symbol="NIFTY",
                )
            ),
            "nifty_ohlc": _probe(
                lambda: groww.get_ohlc(
                    segment=groww.SEGMENT_CASH,
                    exchange_trading_symbols="NSE_NIFTY",
                )
            ),
        }

        expiry_probe, expiry = self._nearest_nifty_expiry(groww)
        derivatives: dict[str, Any] = {"nifty_expiry": expiry_probe}
        if expiry:
            derivatives["nifty_option_chain"] = _probe(
                lambda: groww.get_option_chain(
                    exchange=groww.EXCHANGE_NSE,
                    underlying="NIFTY",
                    expiry_date=expiry,
                ),
                summarize=_summarize_option_chain,
            )
        else:
            derivatives["nifty_option_chain"] = {
                "ok": False,
                "skipped": True,
                "message": "No expiry was resolved, so the option-chain endpoint was not called.",
            }

        status, conclusion = _classify_market_diagnostic(live_data, non_trading)
        data = {
            "profile": profile,
            "non_trading": non_trading,
            "live_data": live_data,
            "derivatives": derivatives,
            "classification": status,
            "conclusion": conclusion,
            "checked_at": datetime.now(timezone.utc).isoformat(),
        }
        self.market_data_status = status
        self.market_data = _json_safe(data)
        self.last_error = None if status == "ok" else conclusion
        return {
            "ok": status == "ok",
            "classification": status,
            "conclusion": conclusion,
            "diagnostic": self.market_data,
        }

    def _write_heartbeat(self) -> None:
        self.control.heartbeat(
            worker_id=self.worker_id,
            state=self.state,
            groww_authenticated=self.groww_authenticated,
            market_data_status=self.market_data_status,
            market_data=self.market_data,
            last_error=self.last_error,
        )

    def run_once(self) -> bool:
        """Process at most one command. Return False when the agent should exit."""
        self._write_heartbeat()
        command = self.control.claim_command(self.worker_id)
        if command is None:
            return True

        command_id = str(command["id"])
        command_name = str(command["command"])
        stop_requested = command_name == "STOP"
        self.state = f"running:{command_name.lower()}"
        self._write_heartbeat()
        try:
            if command_name == "TEST_AUTH":
                result = self._test_auth()
            elif command_name == "TEST_MARKET_DATA":
                result = self._test_market_data()
            elif command_name == "STOP":
                self.state = "stopped"
                result = {"ok": True, "state": self.state}
            else:
                raise RuntimeError(f"unsupported command: {command_name}")
            self.control.complete_command(command_id, result=result)
        except Exception as exc:
            self.last_error = f"{type(exc).__name__}: {exc}"
            if command_name == "TEST_MARKET_DATA":
                self.market_data_status = "error"
            if command_name == "TEST_AUTH":
                self.groww_authenticated = False
            self.control.complete_command(command_id, error=self.last_error)
            logger.exception("control command %s failed", command_name)
        finally:
            if not stop_requested:
                self.state = "idle"
            self._write_heartbeat()

        return not stop_requested

    def run_forever(self) -> None:
        logger.info("Oracle control agent started as %s", self.worker_id)
        while True:
            try:
                if not self.run_once():
                    logger.info("Oracle control agent stopped by dashboard command")
                    return
            except KeyboardInterrupt:
                raise
            except Exception:
                logger.exception("control-plane poll failed")
            time.sleep(self.poll_seconds)
