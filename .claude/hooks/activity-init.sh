#!/usr/bin/env bash
# Activity Init Hook — fires on SessionStart
# Sets up the per-deployment activity log path and writes session_started event.
# Propagates PA_ACTIVITY_LOG to all subsequent hooks via CLAUDE_ENV_FILE.

set -euo pipefail

FALLBACK_LOG="/tmp/pa-activity-fallback.jsonl"

# Determine log path
if [[ -n "${PA_DEPLOYMENT_DIR:-}" ]]; then
    LOG_PATH="${PA_DEPLOYMENT_DIR}/activity.jsonl"
    mkdir -p "${PA_DEPLOYMENT_DIR}"
else
    LOG_PATH="${FALLBACK_LOG}"
fi

# Propagate log path to all subsequent hooks via CLAUDE_ENV_FILE
if [[ -n "${CLAUDE_ENV_FILE:-}" ]]; then
    echo "PA_ACTIVITY_LOG=${LOG_PATH}" >> "${CLAUDE_ENV_FILE}"
fi

# Write session_started event
DEPLOY_ID="${PA_DEPLOYMENT_ID:-unknown}"
TS=$(date -Iseconds)

jq -c -n \
    --arg ts "${TS}" \
    --arg deploy_id "${DEPLOY_ID}" \
    --arg log_path "${LOG_PATH}" \
    '{ts: $ts, deploy_id: $deploy_id, agent: "main", event: "session_started", data: {log_path: $log_path}}' \
    >> "${LOG_PATH}"
