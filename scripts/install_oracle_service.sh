#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${GT_REPO_DIR:-/home/ubuntu/Growing-Trader}"
ENV_FILE="${GT_ENV_FILE:-/home/ubuntu/api.env}"
SERVICE_NAME="${GT_SERVICE_NAME:-growing-trader}"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
RETRY_SERVICE_NAME="${GT_RETRY_SERVICE_NAME:-growing-trader-market-start}"
RETRY_SERVICE_FILE="/etc/systemd/system/${RETRY_SERVICE_NAME}.service"
RETRY_TIMER_NAME="${GT_RETRY_TIMER_NAME:-growing-trader-market-start.timer}"
RETRY_TIMER_FILE="/etc/systemd/system/${RETRY_TIMER_NAME}"
RUN_USER="${GT_RUN_USER:-ubuntu}"

if [[ ! -d "$REPO_DIR/.git" ]]; then
  echo "Repository not found at $REPO_DIR" >&2
  exit 2
fi
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Environment file not found at $ENV_FILE" >&2
  exit 2
fi

run_as_service_user() {
  if [[ "$(id -u)" -eq 0 && "$RUN_USER" != "root" ]]; then
    sudo -u "$RUN_USER" -H "$@"
  else
    "$@"
  fi
}

run_as_service_user git -C "$REPO_DIR" fetch origin main
run_as_service_user git -C "$REPO_DIR" reset --hard origin/main

if [[ ! -x "$REPO_DIR/.venv/bin/python" ]]; then
  run_as_service_user python3 -m venv "$REPO_DIR/.venv"
fi
run_as_service_user "$REPO_DIR/.venv/bin/python" -m pip install --upgrade pip
run_as_service_user "$REPO_DIR/.venv/bin/python" -m pip install -e "$REPO_DIR"

sudo tee "$SERVICE_FILE" >/dev/null <<EOF
[Unit]
Description=Growing Trader Oracle Control Agent
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${REPO_DIR}
ExecStartPre=/usr/bin/git -C ${REPO_DIR} fetch origin main
ExecStartPre=/usr/bin/git -C ${REPO_DIR} reset --hard origin/main
ExecStartPre=${REPO_DIR}/.venv/bin/python -m pip install -e ${REPO_DIR}
ExecStart=/bin/bash -lc 'set -a; source "${ENV_FILE}"; set +a; exec "${REPO_DIR}/.venv/bin/nifty-engine" control-agent'
Restart=on-failure
RestartSec=5
TimeoutStopSec=45
KillSignal=SIGTERM

[Install]
WantedBy=multi-user.target
EOF

sudo tee "$RETRY_SERVICE_FILE" >/dev/null <<EOF
[Unit]
Description=Growing Trader Autonomous Market Start
Wants=network-online.target
After=network-online.target ${SERVICE_NAME}.service
Requires=${SERVICE_NAME}.service

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${REPO_DIR}
ExecStartPre=/bin/sleep 5
ExecStart=/bin/bash -lc 'set -a; source "${ENV_FILE}"; set +a; exec "${REPO_DIR}/.venv/bin/python" -m nifty_engine.autonomous_start_runner'
Restart=on-failure
RestartSec=30
TimeoutStopSec=30
KillSignal=SIGTERM
EOF

sudo tee "$RETRY_TIMER_FILE" >/dev/null <<EOF
[Unit]
Description=Run Growing Trader autonomous market start every weekday

[Timer]
OnCalendar=Mon..Fri *-*-* 09:05:00 Asia/Kolkata
Persistent=true
Unit=${RETRY_SERVICE_NAME}.service
AccuracySec=30s

[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload

# The control agent is a normal boot service. The autonomous market-start runner is
# intentionally timer-only: it must never be pulled into multi-user.target and must
# never be restarted merely because code was deployed or the VM booted.
sudo systemctl enable "$SERVICE_NAME" "$RETRY_TIMER_NAME"
sudo systemctl disable "$RETRY_SERVICE_NAME" >/dev/null 2>&1 || true
sudo systemctl restart "$SERVICE_NAME"
sudo systemctl enable --now "$RETRY_TIMER_NAME"

# Verify the timer is the only automatic activation path for market-start.
if sudo systemctl is-enabled "$RETRY_SERVICE_NAME" >/dev/null 2>&1; then
  echo "${RETRY_SERVICE_NAME} must not be enabled as a standalone boot service" >&2
  exit 1
fi
sudo systemctl is-enabled "$RETRY_TIMER_NAME"
sudo systemctl is-active "$RETRY_TIMER_NAME"

sudo systemctl --no-pager --full status "$SERVICE_NAME" || true
# The market-start service is normally inactive until the 09:05 timer fires.
sudo systemctl --no-pager --full status "$RETRY_SERVICE_NAME" || true
sudo systemctl --no-pager --full status "$RETRY_TIMER_NAME" || true
sudo systemctl list-timers "$RETRY_TIMER_NAME" --no-pager
