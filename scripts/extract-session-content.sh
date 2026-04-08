#!/usr/bin/env bash
# extract-session-content.sh — Post-session extractor for thinking, text, and tool_use_detail
# Reads Claude Code session JSONL and appends extracted entries to the deployment activity log.
#
# Required env vars:
#   PA_DEPLOYMENT_DIR — reads session-jsonl-path.txt from here
#   PA_DEPLOYMENT_ID  — deployment ID for event records
#
# Optional env vars:
#   PA_ACTIVITY_LOG — activity log path (defaults to $PA_DEPLOYMENT_DIR/activity.jsonl)

set -euo pipefail

DEPLOY_DIR="${PA_DEPLOYMENT_DIR:?PA_DEPLOYMENT_DIR not set}"
DEPLOY_ID="${PA_DEPLOYMENT_ID:-unknown}"
ACTIVITY_LOG="${PA_ACTIVITY_LOG:-${DEPLOY_DIR}/activity.jsonl}"

# Step 1: Locate session JSONL via transcript_path saved by UserPromptSubmit hook
SESSION_PATH_FILE="${DEPLOY_DIR}/session-jsonl-path.txt"
if [[ ! -f "${SESSION_PATH_FILE}" ]]; then
    echo "[extract] ${SESSION_PATH_FILE} not found — skipping extraction" >&2
    exit 0
fi
SESSION_JSONL=$(<"${SESSION_PATH_FILE}")
if [[ ! -f "${SESSION_JSONL}" ]]; then
    echo "[extract] Session file not found: ${SESSION_JSONL} — skipping" >&2
    exit 0
fi

# Temp files (cleaned up on exit)
EXTRACTED=$(mktemp)
EXTRACTED_UUIDS=$(mktemp)
trap 'rm -f "${EXTRACTED}" "${EXTRACTED_UUIDS}"' EXIT

# Step 2: Single-pass extraction of all assistant content
jq -c --arg did "${DEPLOY_ID}" '
  select(.type == "assistant") |
  .uuid as $u | .timestamp as $t |
  .message.content[] |
  if .type == "thinking" then
    {ts: $t, deploy_id: $did, agent: "main", event: "thinking",
     data: {uuid: $u, thinking: .thinking, signature: .signature}}
  elif .type == "text" then
    {ts: $t, deploy_id: $did, agent: "main", event: "text",
     data: {uuid: $u, text: .text}}
  elif .type == "tool_use" then
    {ts: $t, deploy_id: $did, agent: "main", event: "tool_use_detail",
     data: {uuid: $u, tool: .name, tool_use_id: .id, input: .input}}
  else empty end
' "${SESSION_JSONL}" > "${EXTRACTED}" 2>/dev/null || true

if [[ ! -s "${EXTRACTED}" ]]; then
    echo "[extract] No content found in session — nothing to extract" >&2
    exit 0
fi

TOTAL=$(wc -l < "${EXTRACTED}")

# Step 3: Extract UUIDs from extracted entries (batch — one jq call)
jq -r '.data.uuid' "${EXTRACTED}" > "${EXTRACTED_UUIDS}"

# Step 4: Build dedup set from existing activity log
declare -A SEEN_UUIDS
if [[ -f "${ACTIVITY_LOG}" ]] && [[ -s "${ACTIVITY_LOG}" ]]; then
    while IFS= read -r uuid; do
        [[ -n "${uuid}" ]] && SEEN_UUIDS["${uuid}"]=1
    done < <(jq -r '.data.uuid // empty' "${ACTIVITY_LOG}" 2>/dev/null || true)
fi

# Step 5: Parallel-read UUIDs + entries, append only new ones
APPENDED=0
exec 3<"${EXTRACTED_UUIDS}"
exec 4<"${EXTRACTED}"
while IFS= read -r uuid <&3 && IFS= read -r line <&4; do
    if [[ -z "${SEEN_UUIDS[${uuid}]+x}" ]]; then
        echo "${line}" >> "${ACTIVITY_LOG}"
        SEEN_UUIDS["${uuid}"]=1
        ((APPENDED++)) || true
    fi
done
exec 3<&-
exec 4<&-

echo "[extract] Appended ${APPENDED}/${TOTAL} entries to activity log" >&2
