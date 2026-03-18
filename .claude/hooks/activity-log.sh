#!/usr/bin/env bash
# Activity Log Hook — universal event logger for PA deployments
# Usage: activity-log.sh <event_type>
# Reads hook input JSON from stdin, appends a JSONL event to the activity log.
#
# Supported event_type values:
#   SubagentStart   — agent spawned
#   SubagentStop    — agent finished
#   TaskCompleted   — task marked complete
#   TeammateIdle    — teammate went idle
#   SessionEnd      — session ended

set -euo pipefail

EVENT_TYPE="${1:-unknown}"
LOG_PATH="${PA_ACTIVITY_LOG:-/tmp/pa-activity-fallback.jsonl}"
DEPLOY_ID="${PA_DEPLOYMENT_ID:-unknown}"
TS=$(date -Iseconds)

# Read stdin (hook input JSON)
INPUT=$(cat)

case "${EVENT_TYPE}" in
    SubagentStart)
        AGENT=$(echo "${INPUT}" | jq -r '.agent_name // .agent_id // "unknown"')
        AGENT_TYPE=$(echo "${INPUT}" | jq -r '.subagent_type // "unknown"')
        DESC=$(echo "${INPUT}" | jq -r '.prompt // "" | .[0:200]')
        MODEL=$(echo "${INPUT}" | jq -r '.model // "unknown"')
        jq -c -n \
            --arg ts "${TS}" \
            --arg deploy_id "${DEPLOY_ID}" \
            --arg agent "${AGENT}" \
            --arg agent_type "${AGENT_TYPE}" \
            --arg event "agent_spawned" \
            --arg desc "${DESC}" \
            --arg model "${MODEL}" \
            '{ts: $ts, deploy_id: $deploy_id, agent: $agent, agent_type: $agent_type, event: $event, data: {description: $desc, model: $model}}' \
            >> "${LOG_PATH}"
        ;;

    SubagentStop)
        AGENT=$(echo "${INPUT}" | jq -r '.agent_name // .agent_id // "unknown"')
        MSG=$(echo "${INPUT}" | jq -r '.last_assistant_message // "" | .[0:500]')
        jq -c -n \
            --arg ts "${TS}" \
            --arg deploy_id "${DEPLOY_ID}" \
            --arg agent "${AGENT}" \
            --arg event "agent_stopped" \
            --arg msg "${MSG}" \
            '{ts: $ts, deploy_id: $deploy_id, agent: $agent, event: $event, data: {last_message: $msg}}' \
            >> "${LOG_PATH}"
        ;;

    TaskCompleted)
        AGENT=$(echo "${INPUT}" | jq -r '.teammate_name // "unknown"')
        SUBJECT=$(echo "${INPUT}" | jq -r '.subject // "unknown"')
        jq -c -n \
            --arg ts "${TS}" \
            --arg deploy_id "${DEPLOY_ID}" \
            --arg agent "${AGENT}" \
            --arg event "task_completed" \
            --arg subject "${SUBJECT}" \
            '{ts: $ts, deploy_id: $deploy_id, agent: $agent, event: $event, data: {subject: $subject}}' \
            >> "${LOG_PATH}"
        ;;

    TeammateIdle)
        AGENT=$(echo "${INPUT}" | jq -r '.agent_name // "unknown"')
        jq -c -n \
            --arg ts "${TS}" \
            --arg deploy_id "${DEPLOY_ID}" \
            --arg agent "${AGENT}" \
            --arg event "teammate_idle" \
            '{ts: $ts, deploy_id: $deploy_id, agent: $agent, event: $event, data: {}}' \
            >> "${LOG_PATH}"
        ;;

    SessionEnd)
        jq -c -n \
            --arg ts "${TS}" \
            --arg deploy_id "${DEPLOY_ID}" \
            --arg event "session_ended" \
            '{ts: $ts, deploy_id: $deploy_id, agent: "main", event: $event, data: {}}' \
            >> "${LOG_PATH}"
        ;;

    *)
        # Unknown event — log raw data, never crash
        echo "${INPUT}" | jq -c \
            --arg ts "${TS}" \
            --arg deploy_id "${DEPLOY_ID}" \
            --arg event "${EVENT_TYPE}" \
            '{ts: $ts, deploy_id: $deploy_id, agent: "main", event: $event, data: .}' \
            >> "${LOG_PATH}" 2>/dev/null || true
        ;;
esac
