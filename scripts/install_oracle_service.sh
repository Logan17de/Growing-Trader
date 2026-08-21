#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${GT_REPO_DIR:-/home/ubuntu/Growing-Trader}"
ENV_FILE="${GT_ENV_FILE:-/home/ubuntu/api.env}"
SERVICE_NAME="${GT_SERVICE_NAME:-growing-trader}"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
RETRY_SERVICE_NAME="${GT_RETRY_SERVICE_NAME:-growing-trader-market-start}"
RETRY_SERVICE_FILE="/etc/systemd/system/${RETRY_SERVICE_NAME}.service"
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
Description=Growing Trader Groww Authentication Retry Watcher
Wants=network-online.target
After=network-online.target ${SERVICE_NAME}.service
Requires=${SERVICE_NAME}.service

[Service]
Type=oneshot
User=${RUN_USER}
WorkingDirectory=${REPO_DIR}
ExecStart=/bin/bash -lc 'set -a; source "${ENV_FILE}"; set +a; exec "${REPO_DIR}/.venv/bin/nifty-engine" scheduled-retry'
TimeoutStartSec=8h

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"
sudo systemctl --no-pager --full status "$SERVICE_NAME" || true
