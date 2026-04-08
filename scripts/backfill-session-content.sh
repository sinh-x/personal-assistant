#!/usr/bin/env bash
# backfill-session-content.sh — Retroactively extract thinking/text/tool_use_detail for old deployments
#
# For each deployment in ~/Documents/ai-usage/deployments/d-*/:
#   1. Skip if already has thinking/text/tool_use_detail events
#   2. If no session-jsonl-path.txt, discover the session file via activity.jsonl session ID
#   3. Run extract-session-content.sh
#
# Usage: backfill-session-content.sh [--dry-run]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTRACT_SCRIPT="${SCRIPT_DIR}/extract-session-content.sh"
DEPLOYMENTS_DIR="${HOME}/Documents/ai-usage/deployments"
CLAUDE_PROJECTS_DIR="${HOME}/.claude/projects"
DRY_RUN=false

[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

if [[ ! -x "${EXTRACT_SCRIPT}" ]]; then
    echo "Error: extract-session-content.sh not found at ${EXTRACT_SCRIPT}" >&2
    exit 1
fi

# Build index of all session JSONL files (prefix → full path)
echo "[backfill] Indexing session JSONL files..." >&2
declare -A SESSION_INDEX
while IFS= read -r filepath; do
    fname=$(basename "${filepath}" .jsonl)
    prefix="${fname:0:8}"
    SESSION_INDEX["${prefix}"]="${filepath}"
done < <(find "${CLAUDE_PROJECTS_DIR}" -name "*.jsonl" -type f 2>/dev/null)
echo "[backfill] Indexed ${#SESSION_INDEX[@]} session files" >&2

TOTAL=0
SKIPPED_DONE=0
SKIPPED_NO_ACTIVITY=0
SKIPPED_NO_SESSION=0
EXTRACTED=0
FAILED=0

for deploy_dir in "${DEPLOYMENTS_DIR}"/d-*/; do
    [[ ! -d "${deploy_dir}" ]] && continue
    TOTAL=$((TOTAL + 1))

    deploy_id=$(basename "${deploy_dir}")
    activity_log="${deploy_dir}activity.jsonl"

    # Skip if no activity.jsonl
    if [[ ! -f "${activity_log}" ]] || [[ ! -s "${activity_log}" ]]; then
        SKIPPED_NO_ACTIVITY=$((SKIPPED_NO_ACTIVITY + 1))
        continue
    fi

    # Skip if already has extracted events
    if grep -qm1 -E '"event":"(thinking|text|tool_use_detail)"' "${activity_log}" 2>/dev/null; then
        SKIPPED_DONE=$((SKIPPED_DONE + 1))
        continue
    fi

    # Progress every 500 deployments
    if (( TOTAL % 500 == 0 )); then
        echo "[backfill] Progress: ${TOTAL} deployments scanned..." >&2
    fi

    # Discover session JSONL if session-jsonl-path.txt is missing
    session_path_file="${deploy_dir}session-jsonl-path.txt"
    if [[ ! -f "${session_path_file}" ]]; then
        # Extract 8-char hex session ID prefix from activity.jsonl agent field (grep for speed)
        session_prefix=$(grep -oP '"agent":"([0-9a-f]{8})"' "${activity_log}" 2>/dev/null | head -1 | grep -oP '[0-9a-f]{8}' || true)

        if [[ -z "${session_prefix}" ]]; then
            SKIPPED_NO_SESSION=$((SKIPPED_NO_SESSION + 1))
            continue
        fi

        # Look up in index
        session_file="${SESSION_INDEX[${session_prefix}]:-}"
        if [[ -z "${session_file}" ]] || [[ ! -f "${session_file}" ]]; then
            SKIPPED_NO_SESSION=$((SKIPPED_NO_SESSION + 1))
            continue
        fi

        if $DRY_RUN; then
            echo "[dry-run] ${deploy_id}: ${session_prefix} → $(basename "${session_file}")" >&2
            EXTRACTED=$((EXTRACTED + 1))
            continue
        fi

        echo "${session_file}" > "${session_path_file}"
    fi

    if $DRY_RUN; then
        echo "[dry-run] ${deploy_id}: would run extraction" >&2
        EXTRACTED=$((EXTRACTED + 1))
        continue
    fi

    # Run extraction
    if PA_DEPLOYMENT_DIR="${deploy_dir}" PA_DEPLOYMENT_ID="${deploy_id}" PA_ACTIVITY_LOG="${activity_log}" \
        bash "${EXTRACT_SCRIPT}" 2>&1 | sed "s/^/  [${deploy_id}] /"; then
        EXTRACTED=$((EXTRACTED + 1))
    else
        echo "  [${deploy_id}] FAILED" >&2
        FAILED=$((FAILED + 1))
    fi
done

echo "" >&2
echo "[backfill] Summary:" >&2
echo "  Total deployments:   ${TOTAL}" >&2
echo "  Already extracted:   ${SKIPPED_DONE}" >&2
echo "  No activity.jsonl:   ${SKIPPED_NO_ACTIVITY}" >&2
echo "  No session found:    ${SKIPPED_NO_SESSION}" >&2
echo "  Extracted:           ${EXTRACTED}" >&2
echo "  Failed:              ${FAILED}" >&2
