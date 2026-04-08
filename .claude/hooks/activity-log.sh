#!/usr/bin/env bash
# Activity Log Hook — universal event logger for PA deployments
# Usage: activity-log.sh <event_type>
# Reads hook input JSON from stdin, appends a JSONL event to the activity log.
#
# Supported event_type values:
#   PreToolUse      — tool call (only fires when PA_ACTIVITY_LOG is set)
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
    PreToolUse)
        # Only log tool calls for PA deployments — silent no-op for all other sessions
        [[ -z "${PA_ACTIVITY_LOG:-}" ]] && exit 0
        TOOL=$(echo "${INPUT}" | jq -r '.tool_name // "unknown"')
        # Agent tool is already captured by SubagentStart — skip to avoid duplication
        [[ "${TOOL}" == "Agent" ]] && exit 0
        SESSION=$(echo "${INPUT}" | jq -r '.session_id // ""' | cut -c1-8)
        # Extract the most useful summary field per tool type
        case "${TOOL}" in
            Bash)
                SUMMARY=$(echo "${INPUT}" | jq -r '.tool_input.command // "" | .[0:200]')
                ;;
            Read)
                SUMMARY=$(echo "${INPUT}" | jq -r '.tool_input.file_path // ""')
                ;;
            Write|Edit)
                SUMMARY=$(echo "${INPUT}" | jq -r '.tool_input.file_path // ""')
                ;;
            Grep)
                SUMMARY=$(echo "${INPUT}" | jq -r '(.tool_input.pattern // "") + " → " + (.tool_input.path // ".")')
                ;;
            Glob)
                SUMMARY=$(echo "${INPUT}" | jq -r '.tool_input.pattern // ""')
                ;;
            WebFetch)
                SUMMARY=$(echo "${INPUT}" | jq -r '.tool_input.url // "" | .[0:150]')
                ;;
            WebSearch)
                SUMMARY=$(echo "${INPUT}" | jq -r '.tool_input.query // ""')
                ;;
            *)
                SUMMARY=$(echo "${INPUT}" | jq -r '.tool_input | to_entries | .[0] | "\(.key)=\(.value | tostring | .[0:80])"' 2>/dev/null || echo "")
                ;;
        esac
        jq -c -n \
            --arg ts "${TS}" \
            --arg deploy_id "${DEPLOY_ID}" \
            --arg session "${SESSION}" \
            --arg tool "${TOOL}" \
            --arg summary "${SUMMARY}" \
            '{ts: $ts, deploy_id: $deploy_id, agent: $session, event: "tool_call", data: {tool: $tool, summary: $summary}}' \
            >> "${LOG_PATH}"
        ;;

    SubagentStart)
        # agent_type = human-readable name for custom agents, or built-in type (Explore, Plan, etc.)
        AGENT=$(echo "${INPUT}" | jq -r '.agent_type // .agent_id // "unknown"')
        AGENT_TYPE=$(echo "${INPUT}" | jq -r '.agent_type // "unknown"')
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
        AGENT=$(echo "${INPUT}" | jq -r '.agent_type // .agent_id // "unknown"')
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
        SUBJECT=$(echo "${INPUT}" | jq -r '.task_subject // .subject // "unknown"')
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
        AGENT=$(echo "${INPUT}" | jq -r '.teammate_name // "unknown"')
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

    PostToolUse)
        # Only log for PA deployments — silent no-op for all other sessions
        [[ -z "${PA_ACTIVITY_LOG:-}" ]] && exit 0
        TOOL=$(echo "${INPUT}" | jq -r '.tool_name // "unknown"')
        TOOL_USE_ID=$(echo "${INPUT}" | jq -r '.tool_use_id // ""')
        SESSION=$(echo "${INPUT}" | jq -r '.session_id // ""' | cut -c1-8)
        # Extract summary per tool type from tool_response
        case "${TOOL}" in
            Bash)
                # Bash tool_response has result: { stdout, stderr, exit_code }
                EXIT_CODE=$(echo "${INPUT}" | jq -r '.tool_response.result.exit_code // -1')
                STDERR=$(echo "${INPUT}" | jq -r '.tool_response.result.stderr // ""' | cut -c1-100)
                if [[ "${EXIT_CODE}" != "0" ]] && [[ -n "${STDERR}" ]]; then
                    SUMMARY="exit_code=${EXIT_CODE} stderr=${STDERR}"
                else
                    SUMMARY="exit_code=${EXIT_CODE}"
                fi
                ;;
            Write|Edit)
                # Write/Edit returns { success: bool, path: string }
                SUCCESS=$(echo "${INPUT}" | jq -r '.tool_response.success // false')
                FILE_PATH=$(echo "${INPUT}" | jq -r '.tool_response.path // ""')
                SUMMARY="success=${SUCCESS} path=${FILE_PATH}"
                ;;
            Read)
                # Read returns content directly
                FILE_PATH=$(echo "${INPUT}" | jq -r '.tool_response.file_path // .tool_input.file_path // ""')
                SUMMARY="path=${FILE_PATH}"
                ;;
            Grep)
                # Grep returns { matches: [...], count: N }
                MATCH_COUNT=$(echo "${INPUT}" | jq -r '.tool_response.count // (.tool_response.matches | length) // 0')
                SUMMARY="matches=${MATCH_COUNT}"
                ;;
            Glob)
                # Glob returns { files: [...] }
                FILE_COUNT=$(echo "${INPUT}" | jq -r '.tool_response.files | length // 0')
                SUMMARY="files=${FILE_COUNT}"
                ;;
            WebFetch)
                # WebFetch returns content summary
                SUMMARY=$(echo "${INPUT}" | jq -r '.tool_response | to_entries | .[0] | "\(.key)=\(.value | tostring | .[0:100])"' 2>/dev/null || echo "fetched")
                ;;
            WebSearch)
                # WebSearch returns results array
                RESULT_COUNT=$(echo "${INPUT}" | jq -r '.tool_response.results | length // 0')
                SUMMARY="results=${RESULT_COUNT}"
                ;;
            Agent)
                # Agent returns final output
                SUMMARY="type=agent"
                ;;
            *)
                # Fallback: first key=value from tool_response
                SUMMARY=$(echo "${INPUT}" | jq -r '.tool_response | to_entries | .[0] | "\(.key)=\(.value | tostring | .[0:100])"' 2>/dev/null || echo "unknown")
                ;;
        esac
        # Truncate summary to ≤200 chars
        SUMMARY=${SUMMARY:0:200}
        jq -c -n \
            --arg ts "${TS}" \
            --arg deploy_id "${DEPLOY_ID}" \
            --arg session "${SESSION}" \
            --arg tool "${TOOL}" \
            --arg tool_use_id "${TOOL_USE_ID}" \
            --arg summary "${SUMMARY}" \
            '{ts: $ts, deploy_id: $deploy_id, agent: $session, event: "tool_success", data: {tool: $tool, tool_use_id: $tool_use_id, summary: $summary}}' \
            >> "${LOG_PATH}"
        ;;

    PostToolUseFailure)
        [[ -z "${PA_ACTIVITY_LOG:-}" ]] && exit 0
        TOOL=$(echo "${INPUT}" | jq -r '.tool_name // "unknown"')
        TOOL_USE_ID=$(echo "${INPUT}" | jq -r '.tool_use_id // ""')
        SESSION=$(echo "${INPUT}" | jq -r '.session_id // ""' | cut -c1-8)
        ERROR=$(echo "${INPUT}" | jq -r '.tool_response.error // "Unknown error"' | cut -c1-200)
        IS_INTERRUPT=$(echo "${INPUT}" | jq -r '.is_interrupt // false')
        jq -c -n \
            --arg ts "${TS}" \
            --arg deploy_id "${DEPLOY_ID}" \
            --arg session "${SESSION}" \
            --arg tool "${TOOL}" \
            --arg tool_use_id "${TOOL_USE_ID}" \
            --arg error "${ERROR}" \
            --arg is_interrupt "${IS_INTERRUPT}" \
            '{ts: $ts, deploy_id: $deploy_id, agent: $session, event: "tool_failure", data: {tool: $tool, tool_use_id: $tool_use_id, error: $error, is_interrupt: $is_interrupt}}' \
            >> "${LOG_PATH}"
        ;;

    Stop)
        [[ -z "${PA_ACTIVITY_LOG:-}" ]] && exit 0
        STOP_REASON=$(echo "${INPUT}" | jq -r '.stop_reason // "unknown"')
        jq -c -n \
            --arg ts "${TS}" \
            --arg deploy_id "${DEPLOY_ID}" \
            --arg stop_reason "${STOP_REASON}" \
            '{ts: $ts, deploy_id: $deploy_id, agent: "main", event: "session_stop", data: {stop_reason: $stop_reason}}' \
            >> "${LOG_PATH}"
        ;;

    StopFailure)
        [[ -z "${PA_ACTIVITY_LOG:-}" ]] && exit 0
        ERROR_TYPE=$(echo "${INPUT}" | jq -r '.error_type // "unknown"')
        ERROR_MSG=$(echo "${INPUT}" | jq -r '.error_message // "Unknown error"' | cut -c1-200)
        jq -c -n \
            --arg ts "${TS}" \
            --arg deploy_id "${DEPLOY_ID}" \
            --arg error_type "${ERROR_TYPE}" \
            --arg error_message "${ERROR_MSG}" \
            '{ts: $ts, deploy_id: $deploy_id, agent: "main", event: "session_stop_failure", data: {error_type: $error_type, error_message: $error_message}}' \
            >> "${LOG_PATH}"
        ;;

    PreCompact)
        [[ -z "${PA_ACTIVITY_LOG:-}" ]] && exit 0
        TRIGGER=$(echo "${INPUT}" | jq -r '.trigger // "auto"')
        jq -c -n \
            --arg ts "${TS}" \
            --arg deploy_id "${DEPLOY_ID}" \
            --arg trigger "${TRIGGER}" \
            '{ts: $ts, deploy_id: $deploy_id, agent: "main", event: "context_compacting", data: {trigger: $trigger}}' \
            >> "${LOG_PATH}"
        ;;

    PostCompact)
        [[ -z "${PA_ACTIVITY_LOG:-}" ]] && exit 0
        TRIGGER=$(echo "${INPUT}" | jq -r '.trigger // "auto"')
        jq -c -n \
            --arg ts "${TS}" \
            --arg deploy_id "${DEPLOY_ID}" \
            --arg trigger "${TRIGGER}" \
            '{ts: $ts, deploy_id: $deploy_id, agent: "main", event: "context_compacted", data: {trigger: $trigger}}' \
            >> "${LOG_PATH}"
        ;;

    PermissionDenied)
        [[ -z "${PA_ACTIVITY_LOG:-}" ]] && exit 0
        TOOL=$(echo "${INPUT}" | jq -r '.tool_name // "unknown"')
        SESSION=$(echo "${INPUT}" | jq -r '.session_id // ""' | cut -c1-8)
        REASON=$(echo "${INPUT}" | jq -r '.reason // "Permission denied"' | cut -c1-200)
        jq -c -n \
            --arg ts "${TS}" \
            --arg deploy_id "${DEPLOY_ID}" \
            --arg session "${SESSION}" \
            --arg tool "${TOOL}" \
            --arg reason "${REASON}" \
            '{ts: $ts, deploy_id: $deploy_id, agent: $session, event: "permission_denied", data: {tool: $tool, reason: $reason}}' \
            >> "${LOG_PATH}"
        ;;

    UserPromptSubmit)
        [[ -z "${PA_ACTIVITY_LOG:-}" ]] && exit 0
        SESSION=$(echo "${INPUT}" | jq -r '.session_id // ""' | cut -c1-8)
        PROMPT=$(echo "${INPUT}" | jq -r '.prompt // "" | .[0:300]')
        IS_CONTINUE=$(echo "${INPUT}" | jq -r '.is_continue // false')
        # Save transcript_path for post-session extraction (PA-1107 / F7)
        TRANSCRIPT_PATH=$(echo "${INPUT}" | jq -r '.transcript_path // ""')
        if [[ -n "${TRANSCRIPT_PATH}" && -n "${PA_DEPLOYMENT_DIR:-}" ]]; then
            echo "${TRANSCRIPT_PATH}" > "${PA_DEPLOYMENT_DIR}/session-jsonl-path.txt"
        fi
        jq -c -n \
            --arg ts "${TS}" \
            --arg deploy_id "${DEPLOY_ID}" \
            --arg session "${SESSION}" \
            --arg prompt "${PROMPT}" \
            --arg is_continue "${IS_CONTINUE}" \
            '{ts: $ts, deploy_id: $deploy_id, agent: $session, event: "user_prompt_submit", data: {prompt: $prompt, is_continue: $is_continue}}' \
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
