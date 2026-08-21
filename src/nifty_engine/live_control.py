from __future__ import annotations

from datetime import datetime, timezone
import logging
from typing import Any

from .control_plane import OracleControlAgent
from .execution import GrowwOrderExecutor, make_order_reference
from .instrument_registry import InstrumentRegistry
from .paper_runner import _parse_datetime, _returned_row, paper_entry_window_open
from .replay_service import replay_stored_history
from .serialization import to_primitive
from .trading_runner import TradingEngineRuntime, TradingPersistence

logger = logging.getLogger(__name__)


class LiveOracleControlAgent(OracleControlAgent):
    """Oracle control worker with a separately startable trading engine."""

    def __init__(self, control: Any, **kwargs: Any) -> None:
        super().__init__(control, **kwargs)
        self.paper_runtime = TradingEngineRuntime(control)

    def _write_paper_status(self) -> None:
        status = self.paper_runtime.status()
        self.control.client.table("paper_engine_status").upsert(
            {"worker_id": self.worker_id, "payload": status, "updated_at": datetime.now(timezone.utc).isoformat()},
            on_conflict="worker_id",
        ).execute()

    def _activity(self, severity: str, event_type: str, title: str, detail: str = "") -> None:
        try:
            self.control.client.table("activity_events").insert({
                "observed_at": datetime.now(timezone.utc).isoformat(), "severity": severity,
                "component": "control-plane", "event_type": event_type, "title": title, "detail": detail,
            }).execute()
        except Exception:
            logger.debug("activity table unavailable", exc_info=True)

    def _start_engine(self) -> dict[str, Any]:
        self.groww_authenticated = True
        status = self.paper_runtime.start(self._groww_client)
        self.last_error = None
        self._write_paper_status()
        return {"ok": True, "trading_engine": status, "paper_engine": status}

    def _run_paper(self) -> dict[str, Any]:
        """Verify Groww first, then start the engine only in PAPER mode."""
        if self._execution_mode() != "paper":
            raise RuntimeError("RUN_PAPER requires PAPER execution mode")
        authentication = self._test_auth()
        started = self._start_engine()
        return {"ok": True, "authentication": authentication, **started}

    def _stop_engine(self) -> dict[str, Any]:
        status = self.paper_runtime.stop()
        self._write_paper_status()
        return {"ok": True, "trading_engine": status, "paper_engine": status}

    def _require_paper_mode_for_legacy_start(self) -> None:
        response = self.control.client.table("execution_control_state").select("mode").eq("id", True).maybe_single().execute()
        mode = str((response.data or {}).get("mode") or "paper")
        if mode != "paper":
            raise RuntimeError("START_PAPER_ENGINE is disabled while LIVE mode is selected; use START_ENGINE")

    def _execution_mode(self) -> str:
        response = self.control.client.table("execution_control_state").select("mode,product").eq("id", True).maybe_single().execute()
        return str((response.data or {}).get("mode") or "paper")

    def _audit_live_positions(self) -> dict[str, Any]:
        """Reconcile Supabase's managed position with Groww's actual NIFTY F&O book.

        Unknown/orphan broker positions are never silently flattened. They activate
        the kill switch and make lifecycle automation fail closed so the VM stays up.
        """
        groww, _profile = self._groww_client()
        persistence = TradingPersistence(self.control.client, 1.0)
        execution = persistence.load_execution_control()
        executor = GrowwOrderExecutor(groww, product=str(execution.get("product") or "MIS"))
        persistence.recover_submitting_entries(executor)
        persistence.recover_pending_exits(executor)
        _risk, managed = persistence.restore_risk_state_for_mode("live")
        broker_positions = executor.broker_nifty_positions()

        mismatches: list[str] = []
        managed_symbol = managed.trading_symbol if managed else None
        managed_quantity = managed.quantity if managed else 0
        broker_by_symbol = {str(row.get("trading_symbol") or ""): int(row.get("quantity") or 0) for row in broker_positions}

        if managed is not None:
            broker_quantity = broker_by_symbol.get(managed.trading_symbol, 0)
            if broker_quantity != managed.quantity:
                mismatches.append(
                    f"managed {managed.trading_symbol}: DB={managed.quantity}, broker={broker_quantity}"
                )

        for row in broker_positions:
            symbol = str(row.get("trading_symbol") or "")
            quantity = int(row.get("quantity") or 0)
            if symbol != managed_symbol and quantity != 0:
                mismatches.append(f"unexpected broker position {symbol}: broker={quantity}, DB=0")

        if managed is None and broker_positions:
            managed_quantity = 0

        if mismatches:
            reason = "LIVE broker reconciliation failed: " + "; ".join(mismatches)
            self.control.client.table("risk_control_state").update({
                "kill_switch": True,
                "block_new_entries": True,
                "reason": reason[:500],
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", True).execute()
            self._activity("critical", "broker_reconciliation", "LIVE broker position mismatch", reason)
            raise RuntimeError(reason)

        result = {
            "ok": True,
            "flat": managed is None and not broker_positions,
            "managed_symbol": managed_symbol,
            "managed_quantity": managed_quantity,
            "broker_positions": broker_positions,
        }
        self._activity(
            "success",
            "broker_reconciliation",
            "LIVE broker positions reconciled",
            "flat" if result["flat"] else f"{managed_symbol}: {managed_quantity}",
        )
        return result

    def _manual_live_entry(self, payload: dict[str, Any], command_id: str) -> dict[str, Any]:
        """Place one discretionary LIVE option BUY from the dashboard.

        The browser only supplies a persisted option symbol and number of lots. Oracle
        revalidates all broker/risk state and uses the same durable reference recovery
        as algorithmic LIVE entries. The runtime is restarted after the fill so it
        immediately adopts and monitors the manually opened managed position.
        """
        runtime = self.paper_runtime.status()
        if not bool(runtime.get("running")):
            raise RuntimeError("manual LIVE entry requires the trading engine to be running")
        if str(runtime.get("mode") or "") != "live":
            raise RuntimeError("manual broker entry is only available while the engine is in LIVE mode")
        if not paper_entry_window_open(datetime.now(timezone.utc), opening_no_entry_minutes=0):
            raise RuntimeError("manual LIVE entries are limited to the NSE entry window (09:15-15:15 IST)")

        symbol = str(payload.get("trading_symbol") or "").strip().upper()
        lots = int(payload.get("lots") or 0)
        if not symbol.startswith("NIFTY") or not symbol.endswith(("CE", "PE")):
            raise ValueError("manual entry must use a persisted NIFTY CE/PE trading symbol")
        if lots < 1 or lots > 20:
            raise ValueError("manual entry lots must be between 1 and 20")

        persistence = TradingPersistence(self.control.client, 1.0)
        execution = persistence.load_execution_control()
        if str(execution.get("mode")) != "live" or not bool(execution.get("live_armed")):
            raise RuntimeError("LIVE execution must be selected and armed before a manual entry")
        max_order_premium = float(execution.get("max_order_premium") or 0.0)
        if max_order_premium <= 0:
            raise RuntimeError("LIVE max order premium must be configured above zero")
        risk_control = persistence.load_risk_control()
        if bool(risk_control.get("kill_switch") or risk_control.get("block_new_entries")):
            raise RuntimeError("manual LIVE entry blocked by the risk/kill-switch state")

        audit = self._audit_live_positions()
        if not bool(audit.get("flat")):
            raise RuntimeError("manual LIVE entry blocked because a managed/broker position is already open")

        latest = self.control.client.table("option_chain_series").select(
            "observed_at,underlying_ltp,expiry,strike,option_type,trading_symbol,ltp,bid_price,ask_price"
        ).eq("trading_symbol", symbol).order("observed_at", desc=True).limit(1).maybe_single().execute()
        row = dict(latest.data or {})
        observed_at = _parse_datetime(row.get("observed_at"))
        if not row or observed_at is None:
            raise RuntimeError("selected option is not present in the persisted live option chain")
        data_age = (datetime.now(timezone.utc) - observed_at.astimezone(timezone.utc)).total_seconds()
        if data_age < 0 or data_age > 60:
            raise RuntimeError(f"selected option quote is stale ({data_age:.1f}s); refresh market data before entry")
        ltp = float(row.get("ltp") or 0.0)
        if ltp <= 0:
            raise RuntimeError("selected option has no valid LTP")

        groww, _profile = self._groww_client()
        registry = InstrumentRegistry(groww)
        lot_size = registry.lot_size_for(symbol, 0)
        if lot_size <= 0:
            raise RuntimeError("could not resolve NIFTY option lot size")
        quantity = lots * lot_size
        requested_premium = ltp * quantity
        if requested_premium > max_order_premium + 1e-9:
            raise RuntimeError(
                f"manual entry premium {requested_premium:.2f} exceeds configured LIVE cap {max_order_premium:.2f}"
            )
        executor = GrowwOrderExecutor(groww, product=str(execution.get("product") or "MIS"))
        available_margin = executor.available_option_buy_margin()
        if requested_premium > available_margin + 1e-9:
            raise RuntimeError(
                f"manual entry premium {requested_premium:.2f} exceeds Groww option-buy margin {available_margin:.2f}"
            )

        reference = make_order_reference("MT", command_id)
        existing = self.control.client.table("orders").select(
            "id,status,broker_order_id,filled_quantity,average_fill_price,raw,created_at"
        ).eq("order_reference_id", reference).maybe_single().execute()
        existing_row = dict(existing.data or {})
        if existing_row and str(existing_row.get("status")) == "OPEN":
            return {
                "ok": True, "manual": True, "recovered": True,
                "order_id": existing_row.get("id"), "broker_order_id": existing_row.get("broker_order_id"),
                "order_reference_id": reference, "trading_symbol": symbol,
                "quantity": int(existing_row.get("filled_quantity") or quantity),
                "average_fill_price": float(existing_row.get("average_fill_price") or 0.0),
            }

        runtime_was_running = bool(runtime.get("running"))
        if runtime_was_running:
            self.paper_runtime.stop()
            self._write_paper_status()
        try:
            now = datetime.now(timezone.utc)
            raw = {
                "mode": "live",
                "execution_source": "manual",
                "manual_entry": True,
                "entry_price": ltp,
                "entry_nifty": float(row.get("underlying_ltp") or runtime.get("nifty_ltp") or 0.0),
                "entry_direction": "bullish" if symbol.endswith("CE") else "bearish",
                "entry_level_name": None,
                "entry_level_price": None,
                "best_price": ltp,
                "original_quantity": quantity,
                "lot_size": lot_size,
                "exit_policy": "dynamic_scalp",
                "requested_price": ltp,
                "requested_lots": lots,
                "max_order_premium": max_order_premium,
                "option_expiry": row.get("expiry"),
                "strike": row.get("strike"),
                "option_type": row.get("option_type"),
            }
            if existing_row:
                order_id = str(existing_row["id"])
                fill = executor.recover_by_reference(reference, quantity)
                if fill is None:
                    raise RuntimeError(f"manual LIVE entry {reference} could not be reconciled")
            else:
                inserted = self.control.client.table("orders").insert({
                    "signal_id": None,
                    "mode": "live",
                    "execution_source": "manual",
                    "trading_symbol": symbol,
                    "side": "BUY",
                    "quantity": quantity,
                    "status": "SUBMITTING",
                    "order_reference_id": reference,
                    "raw": raw,
                }).select("id,created_at").execute()
                order_row = _returned_row(inserted, "manual LIVE order reservation")
                order_id = str(order_row["id"])
                fill = executor.submit_market_option(
                    trading_symbol=symbol,
                    quantity=quantity,
                    side="BUY",
                    order_reference_id=reference,
                )

            if not fill.filled:
                if fill.filled_quantity == 0 and fill.status in {"REJECTED", "FAILED", "CANCELLED"}:
                    self.control.client.table("orders").update({
                        "status": fill.status,
                        "broker_order_id": fill.groww_order_id or None,
                        "filled_quantity": fill.filled_quantity,
                        "average_fill_price": fill.average_fill_price if fill.average_fill_price > 0 else None,
                        "raw": raw | {"live_fill": to_primitive(fill)},
                        "updated_at": now.isoformat(),
                    }).eq("id", order_id).execute()
                else:
                    self.control.client.table("orders").update({
                        "raw": raw | {"live_fill": to_primitive(fill)},
                        "updated_at": now.isoformat(),
                    }).eq("id", order_id).execute()
                raise RuntimeError(f"manual Groww entry is unresolved/not filled: {fill.status}")

            filled_raw = raw | {
                "entry_price": fill.average_fill_price,
                "best_price": fill.average_fill_price,
                "live_fill": to_primitive(fill),
            }
            self.control.client.table("orders").update({
                "status": "OPEN",
                "broker_order_id": fill.groww_order_id,
                "quantity": fill.filled_quantity,
                "filled_quantity": fill.filled_quantity,
                "average_fill_price": fill.average_fill_price,
                "raw": filled_raw,
                "updated_at": now.isoformat(),
            }).eq("id", order_id).execute()
            persistence.write_activity(
                "critical", "manual-live", "manual_live_entry", "Manual LIVE position opened",
                f"{fill.filled_quantity} × {symbol} @ {fill.average_fill_price:.2f}",
                instrument=symbol,
                metadata={"broker_order_id": fill.groww_order_id, "order_reference_id": reference},
            )
            return {
                "ok": True, "manual": True, "order_id": order_id,
                "broker_order_id": fill.groww_order_id, "order_reference_id": reference,
                "trading_symbol": symbol, "lots": lots, "lot_size": lot_size,
                "quantity": fill.filled_quantity, "average_fill_price": fill.average_fill_price,
                "requested_premium": requested_premium,
            }
        finally:
            if runtime_was_running:
                self.paper_runtime.start(self._groww_client)
                self._write_paper_status()

    def _emergency_live_exit(self, fraction: float, reason: str) -> dict[str, Any]:
        groww, _profile = self._groww_client()
        persistence = TradingPersistence(self.control.client, 1.0)
        execution = persistence.load_execution_control()
        if str(execution.get("mode")) != "live":
            raise RuntimeError("emergency broker exit is only available for LIVE mode")
        executor = GrowwOrderExecutor(groww, product=str(execution.get("product") or "MIS"))
        persistence.recover_submitting_entries(executor)
        persistence.recover_pending_exits(executor)
        _risk, position = persistence.restore_risk_state_for_mode("live")
        broker_positions = executor.broker_nifty_positions()
        if position is None:
            if broker_positions:
                reason_text = "Broker has NIFTY F&O position(s) not represented by the managed DB position"
                self.control.client.table("risk_control_state").update({
                    "kill_switch": True, "block_new_entries": True, "reason": reason_text,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }).eq("id", True).execute()
                raise RuntimeError(f"{reason_text}: {broker_positions}")
            return {"ok": True, "closed": False, "reason": "no open LIVE position"}
        extras = [row for row in broker_positions if str(row.get("trading_symbol") or "") != position.trading_symbol]
        if extras:
            raise RuntimeError(f"unexpected additional NIFTY broker positions; refusing automated exit: {extras}")
        broker_quantity = executor.broker_position_quantity(position.trading_symbol)
        if broker_quantity is None or broker_quantity != position.quantity:
            self.control.client.table("risk_control_state").update({
                "kill_switch": True, "block_new_entries": True,
                "reason": f"Emergency exit reconciliation mismatch for {position.trading_symbol}: DB={position.quantity}, broker={broker_quantity}",
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", True).execute()
            raise RuntimeError(f"cannot safely exit: DB quantity {position.quantity} != broker quantity {broker_quantity}")
        pnl, closed, fill = persistence.reduce_live_order(
            position, executor=executor, observed_at=datetime.now(timezone.utc), exit_reason=reason, fraction=fraction,
        )
        return {
            "ok": True, "closed": closed, "remaining_quantity": 0 if closed else position.quantity,
            "filled_quantity": fill.filled_quantity, "average_fill_price": fill.average_fill_price,
            "broker_order_id": fill.groww_order_id, "pnl": pnl,
        }

    def _exit_position(self, payload: dict[str, Any]) -> dict[str, Any]:
        fraction = float(payload.get("fraction", 1.0))
        runtime = self.paper_runtime.status()
        if bool(runtime.get("running")):
            return self.paper_runtime.request_exit(fraction)
        if self._execution_mode() == "live":
            return self._emergency_live_exit(fraction, "manual_exit_control")
        return self.paper_runtime.request_exit(fraction)

    def _set_kill_switch(self, enabled: bool, payload: dict[str, Any]) -> dict[str, Any]:
        close_position = bool(payload.get("close_position", True))
        reason = str(payload.get("reason") or ("Dashboard kill switch" if enabled else "Kill switch reset"))[:500]
        self.control.client.table("risk_control_state").update({
            "kill_switch": enabled, "block_new_entries": enabled,
            "close_open_position_on_kill": close_position, "reason": reason,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", True).execute()
        result = self.paper_runtime.set_kill_switch(enabled, close_position=close_position)
        emergency: dict[str, Any] | None = None
        if enabled and close_position and not bool(self.paper_runtime.status().get("running")) and self._execution_mode() == "live":
            emergency = self._emergency_live_exit(1.0, "kill_switch")
        self._activity("critical" if enabled else "success", "kill_switch", "Kill switch activated" if enabled else "Kill switch reset", reason)
        return {**result, "emergency_exit": emergency} if emergency is not None else result

    def _run_replay(self, payload: dict[str, Any]) -> dict[str, Any]:
        run_id = str(payload.get("replay_run_id") or "")
        if not run_id:
            raise ValueError("replay_run_id is required")
        try:
            result = replay_stored_history(self.control.client, run_id)
            self._activity("success", "replay", "Historical replay completed", f"Replay {run_id}: {result.get('frames', 0)} frames")
            return {"ok": True, "replay_run_id": run_id, "result": result}
        except Exception as exc:
            self.control.client.table("replay_runs").update({
                "status": "failed", "error": f"{type(exc).__name__}: {exc}",
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", run_id).execute()
            raise

    def run_once(self) -> bool:
        self._write_heartbeat()
        self._write_paper_status()
        command = self.control.claim_command(self.worker_id)
        if command is None:
            return True

        command_id = str(command["id"])
        command_name = str(command["command"])
        payload = dict(command.get("payload") or {})
        stop_requested = command_name == "STOP"
        self.state = f"running:{command_name.lower()}"
        self._write_heartbeat()
        try:
            if command_name == "TEST_AUTH":
                result = self._test_auth()
            elif command_name == "TEST_MARKET_DATA":
                result = self._test_market_data()
            elif command_name == "RUN_PAPER":
                result = self._run_paper()
            elif command_name == "START_PAPER_ENGINE":
                self._require_paper_mode_for_legacy_start()
                result = self._start_engine()
            elif command_name == "START_ENGINE":
                result = self._start_engine()
            elif command_name in {"STOP_PAPER_ENGINE", "STOP_ENGINE"}:
                result = self._stop_engine()
            elif command_name == "EXIT_PAPER_POSITION":
                result = self._exit_position(payload)
            elif command_name == "UPDATE_PAPER_POSITION":
                result = self.paper_runtime.update_position_controls(payload)
            elif command_name == "KILL_SWITCH":
                result = self._set_kill_switch(True, payload)
            elif command_name == "RESET_KILL_SWITCH":
                result = self._set_kill_switch(False, payload)
            elif command_name == "CHECK_LIVE_POSITIONS":
                result = self._audit_live_positions()
            elif command_name == "MANUAL_LIVE_ENTRY":
                result = self._manual_live_entry(payload, command_id)
            elif command_name == "RUN_REPLAY":
                result = self._run_replay(payload)
            elif command_name == "STOP":
                self.paper_runtime.stop()
                self._write_paper_status()
                self.state = "stopped"
                result = {"ok": True, "state": self.state, "trading_engine": self.paper_runtime.status(), "paper_engine": self.paper_runtime.status()}
            else:
                raise RuntimeError(f"unsupported command: {command_name}")
            self.control.complete_command(command_id, result=result)
            if command_name not in {"RUN_REPLAY", "KILL_SWITCH", "RESET_KILL_SWITCH"}:
                self._activity("success", "command", command_name.replace("_", " ").title(), "Command completed")
        except Exception as exc:
            self.last_error = f"{type(exc).__name__}: {exc}"
            if command_name == "TEST_MARKET_DATA":
                self.market_data_status = "error"
            if command_name in {"TEST_AUTH", "RUN_PAPER"}:
                self.groww_authenticated = False
            self.control.complete_command(command_id, error=self.last_error)
            self._activity("critical", "command_failed", f"{command_name} failed", self.last_error)
            logger.exception("control command %s failed", command_name)
        finally:
            if not stop_requested:
                self.state = "idle"
            self._write_heartbeat()
            try:
                self._write_paper_status()
            except Exception:
                logger.exception("trading-engine status write failed")

        return not stop_requested