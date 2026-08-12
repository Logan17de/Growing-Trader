from __future__ import annotations

from base64 import urlsafe_b64decode
from dataclasses import dataclass
import json
import logging
import os
import socket
import time
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

logger = logging.getLogger(__name__)


def _decode_base64url(value: str) -> bytes:
    return urlsafe_b64decode(value + "=" * (-len(value) % 4))


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
        self, command_id: str, *, result: dict[str, Any] | None = None,
        error: str | None = None,
    ) -> None:
        values: dict[str, Any] = {
            "status": "failed" if error else "completed",
            "completed_at": "now()",
            "result": result,
            "error": error,
        }
        # PostgREST does not interpret now() strings as SQL functions, so use an ISO timestamp.
        from datetime import datetime, timezone
        values["completed_at"] = datetime.now(timezone.utc).isoformat()
        self.client.table("engine_commands").update(values).eq("id", command_id).execute()

    def heartbeat(
        self, *, worker_id: str, state: str, groww_authenticated: bool = False,
        market_data_status: str = "unknown", market_data: dict[str, Any] | None = None,
        last_error: str | None = None,
    ) -> None:
        from datetime import datetime, timezone

        now = datetime.now(timezone.utc).isoformat()
        self.client.table("engine_status").upsert({
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
        }, on_conflict="worker_id").execute()


class OracleControlAgent:
    """Outbound-only Oracle agent for Vercel/Supabase dashboard commands."""

    def __init__(
        self, control: SupabaseControlPlane, *, worker_id: str = "oracle-primary",
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
            api_key=credentials.api_key, secret=credentials.api_secret
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

    def _test_market_data(self) -> dict[str, Any]:
        groww, profile = self._groww_client()
        self.groww_authenticated = True
        ltp = groww.get_ltp(
            segment=groww.SEGMENT_CASH,
            exchange_trading_symbols="NSE_NIFTY",
        )
        quote = groww.get_quote(
            exchange=groww.EXCHANGE_NSE,
            segment=groww.SEGMENT_CASH,
            trading_symbol="NIFTY",
        )
        data = {
            "profile": profile,
            "ltp": ltp,
            "quote": quote,
        }
        self.market_data_status = "ok"
        self.market_data = json.loads(json.dumps(data, default=str))
        self.last_error = None
        return {"ok": True, "market_data": self.market_data}

    def _write_heartbeat(self) -> None:
        self.control.heartbeat(
            worker_id=self.worker_id,
            state=self.state,
            groww_authenticated=self.groww_authenticated,
            market_data_status=self.market_data_status,
            market_data=self.market_data,
            last_error=self.last_error,
        )

    def run_once(self) -> None:
        self._write_heartbeat()
        command = self.control.claim_command(self.worker_id)
        if command is None:
            return

        command_id = str(command["id"])
        command_name = str(command["command"])
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
            if self.state != "stopped":
                self.state = "idle"
            self._write_heartbeat()

    def run_forever(self) -> None:
        logger.info("Oracle control agent started as %s", self.worker_id)
        while True:
            try:
                self.run_once()
            except KeyboardInterrupt:
                raise
            except Exception:
                logger.exception("control-plane poll failed")
            time.sleep(self.poll_seconds)
