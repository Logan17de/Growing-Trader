from __future__ import annotations

import base64
import os
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import pytest

from nifty_engine.control_plane import CredentialCipher, OracleControlAgent


def _base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def test_credential_cipher_matches_dashboard_wire_format() -> None:
    key = os.urandom(32)
    iv = os.urandom(12)
    plaintext = b"groww-secret-with-shell-characters-()#%"
    encrypted = AESGCM(key).encrypt(iv, plaintext, None)
    packed = f"v1.{_base64url(iv)}.{_base64url(encrypted)}"

    cipher = CredentialCipher(base64.b64encode(key).decode("ascii"))
    assert cipher.decrypt(packed) == plaintext.decode("utf-8")


def test_credential_cipher_rejects_wrong_key_size() -> None:
    with pytest.raises(ValueError, match="exactly 32 bytes"):
        CredentialCipher(base64.b64encode(b"short").decode("ascii"))


class FakeControlPlane:
    def __init__(self, commands: list[dict[str, Any]]) -> None:
        self.commands = list(commands)
        self.heartbeats: list[dict[str, Any]] = []
        self.completed: list[tuple[str, dict[str, Any] | None, str | None]] = []

    def heartbeat(self, **values: Any) -> None:
        self.heartbeats.append(values)

    def claim_command(self, worker_id: str) -> dict[str, Any] | None:
        del worker_id
        return self.commands.pop(0) if self.commands else None

    def complete_command(
        self,
        command_id: str,
        *,
        result: dict[str, Any] | None = None,
        error: str | None = None,
    ) -> None:
        self.completed.append((command_id, result, error))


def test_stop_command_really_stops_agent_loop() -> None:
    control = FakeControlPlane([{"id": "cmd-1", "command": "STOP"}])
    agent = OracleControlAgent(control, poll_seconds=0.01)  # type: ignore[arg-type]

    assert agent.run_once() is False
    assert agent.state == "stopped"
    assert control.completed == [("cmd-1", {"ok": True, "state": "stopped"}, None)]
    assert control.heartbeats[-1]["state"] == "stopped"


def test_idle_poll_keeps_agent_running() -> None:
    control = FakeControlPlane([])
    agent = OracleControlAgent(control, poll_seconds=0.01)  # type: ignore[arg-type]

    assert agent.run_once() is True
    assert agent.state == "idle"
    assert control.heartbeats[-1]["state"] == "idle"


class FakeForbiddenError(Exception):
    code = "GA005"
    msg = "Access forbidden for this request."


class FakeForbiddenGroww:
    EXCHANGE_NSE = "NSE"
    SEGMENT_CASH = "CASH"

    def get_holdings_for_user(self) -> dict[str, Any]:
        return {"holdings": []}

    def get_positions_for_user(self) -> dict[str, Any]:
        return {"positions": []}

    def get_ltp(self, **_: Any) -> dict[str, Any]:
        raise FakeForbiddenError("Access forbidden for this request.")

    def get_quote(self, **_: Any) -> dict[str, Any]:
        raise FakeForbiddenError("Access forbidden for this request.")

    def get_ohlc(self, **_: Any) -> dict[str, Any]:
        raise FakeForbiddenError("Access forbidden for this request.")

    def get_expiries(self, **_: Any) -> dict[str, Any]:
        return {"expiries": ["2099-01-01"]}

    def get_option_chain(self, **_: Any) -> dict[str, Any]:
        raise FakeForbiddenError("Access forbidden for this request.")


def test_market_diagnostic_completes_and_captures_groww_error_code() -> None:
    control = FakeControlPlane([{"id": "cmd-2", "command": "TEST_MARKET_DATA"}])
    agent = OracleControlAgent(control, poll_seconds=0.01)  # type: ignore[arg-type]
    fake_groww = FakeForbiddenGroww()
    agent._groww_client = lambda: (  # type: ignore[method-assign]
        fake_groww,
        {"nse_enabled": True, "active_segments": ["CASH", "FNO"]},
    )

    assert agent.run_once() is True
    command_id, result, error = control.completed[-1]
    assert command_id == "cmd-2"
    assert error is None
    assert result is not None
    assert result["classification"] == "forbidden"
    assert result["diagnostic"]["live_data"]["nifty_ltp"]["code"] == "GA005"
    assert result["diagnostic"]["non_trading"]["holdings"]["ok"] is True
    assert agent.market_data_status == "forbidden"
    assert "Live Data" in result["conclusion"]
