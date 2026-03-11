#!/usr/bin/env bash
set -euo pipefail

# Show deployment status from the registry
#
# Usage: ./status.sh              — show all recent deployments
#        ./status.sh <deploy-id>  — show details for one deployment
#        ./status.sh --running    — show only running deployments
#        ./status.sh --team <name> — filter by team name

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PA_DATA="${PA_DATA:-$SCRIPT_DIR}"          # mutable: primers/, logs/

DEPLOYMENTS_DIR="${HOME}/Documents/ai-usage/deployments"
REGISTRY_FILE="$DEPLOYMENTS_DIR/registry.jsonl"
LOGS_DIR="$PA_DATA/logs"

if [[ ! -f "$REGISTRY_FILE" ]]; then
    echo "No deployments yet. Registry not found: $REGISTRY_FILE"
    exit 0
fi

filter_mode="${1:-all}"
filter_value="${2:-}"

# --- Helpers ---

# Check if a PID is still running
is_alive() {
    kill -0 "$1" 2>/dev/null
}

# Format timestamp to short form
short_ts() {
    echo "$1" | sed 's/T/ /' | cut -c1-19
}

# --- Parse registry into deployment records ---

declare -A deploy_team deploy_started deploy_pid deploy_status deploy_ended deploy_summary deploy_agents deploy_primer

while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    did="$(echo "$line" | sed -n 's/.*"deployment_id":"\([^"]*\)".*/\1/p')"
    [[ -z "$did" ]] && continue
    event="$(echo "$line" | sed -n 's/.*"event":"\([^"]*\)".*/\1/p')"

    case "$event" in
        started)
            deploy_team["$did"]="$(echo "$line" | sed -n 's/.*"team":"\([^"]*\)".*/\1/p')"
            deploy_started["$did"]="$(echo "$line" | sed -n 's/.*"timestamp":"\([^"]*\)".*/\1/p')"
            deploy_agents["$did"]="$(echo "$line" | sed -n 's/.*"agents":\[\([^]]*\)\].*/\1/p' | tr -d '"')"
            deploy_primer["$did"]="$(echo "$line" | sed -n 's/.*"primer":"\([^"]*\)".*/\1/p')"
            deploy_status["$did"]="running"
            ;;
        pid)
            deploy_pid["$did"]="$(echo "$line" | sed -n 's/.*"pid":\([0-9]*\).*/\1/p')"
            ;;
        completed)
            deploy_status["$did"]="$(echo "$line" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p')"
            deploy_ended["$did"]="$(echo "$line" | sed -n 's/.*"timestamp":"\([^"]*\)".*/\1/p')"
            deploy_summary["$did"]="$(echo "$line" | sed -n 's/.*"summary":"\([^"]*\)".*/\1/p')"
            ;;
        crashed)
            deploy_status["$did"]="crashed"
            deploy_ended["$did"]="$(echo "$line" | sed -n 's/.*"timestamp":"\([^"]*\)".*/\1/p')"
            exit_code="$(echo "$line" | sed -n 's/.*"exit_code":\([0-9]*\).*/\1/p')"
            deploy_summary["$did"]="exit code ${exit_code}"
            ;;
    esac
done < "$REGISTRY_FILE"

# --- Check if "running" deployments are actually still alive ---

for did in "${!deploy_status[@]}"; do
    if [[ "${deploy_status[$did]}" == "running" ]]; then
        pid="${deploy_pid[$did]:-}"
        if [[ -n "$pid" ]] && ! is_alive "$pid"; then
            deploy_status["$did"]="dead"
            deploy_summary["$did"]="PID ${pid} no longer running (no completion marker)"
        fi
    fi
done

# --- Detail view for a single deployment ---

if [[ "$filter_mode" != "all" && "$filter_mode" != "--running" && "$filter_mode" != "--team" ]]; then
    did="$filter_mode"
    if [[ -z "${deploy_team[$did]:-}" ]]; then
        echo "Deployment not found: $did"
        exit 1
    fi

    status="${deploy_status[$did]}"
    case "$status" in
        success)  status_icon="OK" ;;
        partial)  status_icon=".." ;;
        failed|crashed|dead) status_icon="!!" ;;
        running)  status_icon=">>" ;;
        *)        status_icon="??" ;;
    esac

    echo "Deployment: $did"
    echo "  Team:     ${deploy_team[$did]}"
    echo "  Status:   [${status_icon}] ${status}"
    echo "  Started:  $(short_ts "${deploy_started[$did]}")"
    [[ -n "${deploy_ended[$did]:-}" ]] && echo "  Ended:    $(short_ts "${deploy_ended[$did]}")"

    # Show runtime for running or completed
    if [[ -n "${deploy_started[$did]:-}" ]]; then
        start_epoch="$(date -d "${deploy_started[$did]}" +%s 2>/dev/null || echo "")"
        if [[ -n "$start_epoch" ]]; then
            if [[ -n "${deploy_ended[$did]:-}" ]]; then
                end_epoch="$(date -d "${deploy_ended[$did]}" +%s 2>/dev/null || echo "")"
            else
                end_epoch="$(date +%s)"
            fi
            if [[ -n "$end_epoch" ]]; then
                elapsed=$(( end_epoch - start_epoch ))
                mins=$(( elapsed / 60 ))
                secs=$(( elapsed % 60 ))
                echo "  Runtime:  ${mins}m ${secs}s"
            fi
        fi
    fi

    echo "  Agents:   ${deploy_agents[$did]:-none}"
    [[ -n "${deploy_pid[$did]:-}" ]] && echo "  PID:      ${deploy_pid[$did]}"
    [[ -n "${deploy_summary[$did]:-}" ]] && echo "  Summary:  ${deploy_summary[$did]}"

    # Show log file if exists
    log_file="$LOGS_DIR/${deploy_team[$did]}-${did}.log"
    if [[ -f "$log_file" ]]; then
        log_size="$(stat -c%s "$log_file" 2>/dev/null || echo "0")"
        echo "  Log:      $log_file (${log_size} bytes)"
        if [[ "$log_size" -eq 0 ]]; then
            echo ""
            echo "  WARNING: Log is empty — process may be stuck"
        else
            echo ""
            echo "--- Last 20 lines of log ---"
            tail -20 "$log_file"
        fi
    fi

    # Show primer file
    [[ -n "${deploy_primer[$did]:-}" && -f "${deploy_primer[$did]}" ]] && echo "  Primer:   ${deploy_primer[$did]}"

    exit 0
fi

# --- List view ---

# Collect deployment IDs sorted by start time (most recent first)
sorted_dids=()
for did in "${!deploy_started[@]}"; do
    echo "${deploy_started[$did]} $did"
done | sort -r | while read -r _ did; do
    sorted_dids+=("$did")
done

# If sort pipe didn't work (subshell), fallback to unsorted
if [[ ${#sorted_dids[@]} -eq 0 ]]; then
    sorted_dids=("${!deploy_started[@]}")
fi

# Header
printf "%-12s %-22s %-10s %-20s %-20s %s\n" "DEPLOY-ID" "TEAM" "STATUS" "STARTED" "ENDED" "SUMMARY"
printf "%-12s %-22s %-10s %-20s %-20s %s\n" "-----------" "---------------------" "---------" "-------------------" "-------------------" "-------"

for did in "${sorted_dids[@]}"; do
    team="${deploy_team[$did]:-?}"
    status="${deploy_status[$did]:-?}"
    started="$(short_ts "${deploy_started[$did]:-?}")"
    ended="${deploy_ended[$did]:-}"
    [[ -n "$ended" ]] && ended="$(short_ts "$ended")" || ended="-"
    summary="${deploy_summary[$did]:-}"

    # Apply filters
    if [[ "$filter_mode" == "--running" && "$status" != "running" ]]; then
        continue
    fi
    if [[ "$filter_mode" == "--team" && "$team" != "$filter_value" ]]; then
        continue
    fi

    # Status icon
    case "$status" in
        success)  si="OK" ;;
        partial)  si=".." ;;
        failed|crashed|dead) si="!!" ;;
        running)  si=">>" ;;
        *)        si="??" ;;
    esac

    # Truncate summary
    [[ ${#summary} -gt 50 ]] && summary="${summary:0:47}..."

    printf "%-12s %-22s [%-2s] %-4s %-20s %-20s %s\n" "$did" "$team" "$si" "" "$started" "$ended" "$summary"
done
