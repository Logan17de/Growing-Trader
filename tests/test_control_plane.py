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
