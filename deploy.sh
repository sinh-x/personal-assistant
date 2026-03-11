#!/usr/bin/env bash
set -euo pipefail

# Deploy an agent team by generating a primer and running claude
#
# Usage: ./deploy.sh <team-name-or-file> [--dry-run | --foreground | --interactive]
#
# First arg can be:
#   - A file path (absolute or relative) to a YAML team file
#   - A team name, resolved as $TEAMS_DIR/<name>.yaml
#
# Default: runs in background, tracks status in deployment registry
# --foreground: runs in foreground with auto-permissions (for debugging)
# --interactive: runs in foreground WITHOUT auto-permissions (user approves each tool call)
# --dry-run: generates primer and prints it, no execution

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PA_HOME="${PA_HOME:-$SCRIPT_DIR}"       # read-only: teams/, skills/
PA_DATA="${PA_DATA:-$PA_HOME}"          # mutable: primers/, logs/

TEAMS_DIR="$PA_HOME/teams"
SKILLS_DIR="$PA_HOME/skills"
PRIMERS_DIR="$PA_DATA/primers"
LOGS_DIR="$PA_DATA/logs"
DEPLOYMENTS_DIR="${HOME}/Documents/ai-usage/deployments"
REGISTRY_FILE="$DEPLOYMENTS_DIR/registry.jsonl"
REGISTRY_LOCK="$DEPLOYMENTS_DIR/.registry.lock"

spec="${1:?Usage: ./deploy.sh <team-name-or-file> [--dry-run | --foreground]}"
mode="${2:-background}"

# --- Resolve team file: file path or name ---

if [[ -f "$spec" ]]; then
    team_file="$(cd "$(dirname "$spec")" && pwd)/$(basename "$spec")"
    team_name="$(basename "$spec" .yaml)"
else
    team_name="$spec"
    team_file="$TEAMS_DIR/${team_name}.yaml"
fi

if [[ ! -f "$team_file" ]]; then
    echo "Error: Team file not found: $team_file" >&2
    exit 1
fi

mkdir -p "$PRIMERS_DIR" "$LOGS_DIR" "$DEPLOYMENTS_DIR"

# --- Generate deployment ID ---

deploy_id="d-$(head -c 3 /dev/urandom | xxd -p)"
deploy_ts="$(date -Iseconds)"

# --- Create workspace base for this deployment ---
mkdir -p "$DEPLOYMENTS_DIR/${deploy_id}"

# --- Parse YAML (basic, no yq dependency — just grep/sed) ---

get_field() {
    grep "^${1}:" "$team_file" | sed "s/^${1}:[[:space:]]*//" | sed 's/^"//' | sed 's/"$//'
}

team_display_name="$(get_field name)"
team_description="$(get_field description)"
objective="$(sed -n '/^objective:/,/^[a-z]/{ /^objective:/d; /^[a-z]/d; s/^  //; p; }' "$team_file")"

# --- Collect agent names ---

agent_names=()
while IFS= read -r line; do
    if [[ "$line" =~ ^[[:space:]]*-[[:space:]]*name: ]]; then
        aname="$(echo "$line" | sed 's/.*name:[[:space:]]*//' | sed 's/^"//' | sed 's/"$//')"
        agent_names+=("$aname")
    fi
done < "$team_file"

# --- Build primer ---

primer_file="$PRIMERS_DIR/${team_name}-${deploy_id}-primer.md"

cat > "$primer_file" << PRIMER_EOF
# Deployment Primer: ${team_display_name}

You are being deployed as the team manager for "${team_display_name}".

<deployment-context>
deployment_id: ${deploy_id}
team_name: ${team_name}
team_display_name: ${team_display_name}
deployed_at: ${deploy_ts}
registry_file: ${REGISTRY_FILE}
registry_lock: ${REGISTRY_LOCK}
workspace_base: ${DEPLOYMENTS_DIR}/${deploy_id}
agents:
$(printf '  - %s\n' "${agent_names[@]}")
</deployment-context>

Your identity is **team-manager** (team: **${team_name}**, deployment: **${deploy_id}**).
You MUST follow all rules in the **Global Skills** section below — especially \`standards.md\`.

## Team Description
${team_description}

## Agents

PRIMER_EOF

# Parse agents (basic line-by-line)
in_agents=false
current_agent_name=""
current_agent_role=""
current_agent_skill=""

while IFS= read -r line; do
    if [[ "$line" == "agents:" ]]; then
        in_agents=true
        continue
    fi
    if [[ "$in_agents" == true ]]; then
        # Stop at next top-level key
        if [[ "$line" =~ ^[a-z] && ! "$line" =~ ^[[:space:]] ]]; then
            break
        fi
        if [[ "$line" =~ ^[[:space:]]*-[[:space:]]*name: ]]; then
            # Flush previous agent
            if [[ -n "$current_agent_name" ]]; then
                echo "### Agent: ${current_agent_name}" >> "$primer_file"
                echo "Role: ${current_agent_role}" >> "$primer_file"
                if [[ -n "$current_agent_skill" && -f "$PA_HOME/$current_agent_skill" ]]; then
                    echo "" >> "$primer_file"
                    echo "<skill-file name=\"${current_agent_name}\">" >> "$primer_file"
                    cat "$PA_HOME/$current_agent_skill" >> "$primer_file"
                    echo "</skill-file>" >> "$primer_file"
                fi
                echo "" >> "$primer_file"
            fi
            current_agent_name="$(echo "$line" | sed 's/.*name:[[:space:]]*//' | sed 's/^"//' | sed 's/"$//')"
            current_agent_role=""
            current_agent_skill=""
        elif [[ "$line" =~ ^[[:space:]]*role: ]]; then
            current_agent_role="$(echo "$line" | sed 's/.*role:[[:space:]]*//' | sed 's/^"//' | sed 's/"$//')"
        elif [[ "$line" =~ ^[[:space:]]*skill: ]]; then
            current_agent_skill="$(echo "$line" | sed 's/.*skill:[[:space:]]*//' | sed 's/^"//' | sed 's/"$//')"
        fi
    fi
done < "$team_file"

# Flush last agent
if [[ -n "$current_agent_name" ]]; then
    echo "### Agent: ${current_agent_name}" >> "$primer_file"
    echo "Role: ${current_agent_role}" >> "$primer_file"
    if [[ -n "$current_agent_skill" && -f "$PA_HOME/$current_agent_skill" ]]; then
        echo "" >> "$primer_file"
        echo "<skill-file name=\"${current_agent_name}\">" >> "$primer_file"
        cat "$PA_HOME/$current_agent_skill" >> "$primer_file"
        echo "</skill-file>" >> "$primer_file"
    fi
    echo "" >> "$primer_file"
fi

# --- Inject global skills ---

global_skills_dir="$SKILLS_DIR/global"
if [[ -d "$global_skills_dir" ]]; then
    echo "## Global Skills (apply to ALL agents)" >> "$primer_file"
    echo "" >> "$primer_file"
    for gskill in "$global_skills_dir"/*.md; do
        [[ -f "$gskill" ]] || continue
        gskill_name="$(basename "$gskill" .md)"
        echo "<global-skill name=\"${gskill_name}\">" >> "$primer_file"
        cat "$gskill" >> "$primer_file"
        echo "" >> "$primer_file"
        echo "</global-skill>" >> "$primer_file"
        echo "" >> "$primer_file"
    done
fi

cat >> "$primer_file" << OBJECTIVE_EOF

## Objective

${objective}

## Deployment Instructions

1. **Read the global standards** in the Global Skills section — especially \`standards.md\`
2. **Create the team** using TeamCreate with team name "${team_name}"
3. **Spawn each agent** — pass deployment context per standards §3 (deployment_id, team_name, parent)
4. **Create tasks** from the objective and assign to agents
5. **Coordinate** — monitor via TaskList, unblock as needed
6. **Shutdown sequence** — follow standards §6: sub-agents log → agents log → you log → write completion marker → exit
OBJECTIVE_EOF

echo "Primer generated: $primer_file"

# --- Dry run ---

if [[ "$mode" == "--dry-run" ]]; then
    echo "--- DRY RUN — primer content: ---"
    cat "$primer_file"
    exit 0
fi

# --- Write start event to registry (locked) ---

registry_write() {
    flock -w 5 "$REGISTRY_LOCK" bash -c "echo '$1' >> '$REGISTRY_FILE'"
}

registry_write "{\"deployment_id\":\"${deploy_id}\",\"team\":\"${team_name}\",\"event\":\"started\",\"timestamp\":\"${deploy_ts}\",\"agents\":[$(printf '"%s",' "${agent_names[@]}" | sed 's/,$//')],\"primer\":\"${primer_file}\"}"

# --- Deploy ---

unset CLAUDECODE 2>/dev/null || true

claude_cmd="Read the deployment primer at '${primer_file}' using the Read tool and follow ALL instructions in it exactly. Start immediately. When finished, write the completion marker and exit."

if [[ "$mode" == "--interactive" ]]; then
    echo "Deploying team (interactive): ${team_display_name} [${deploy_id}]"
    echo "  You will be prompted to approve tool calls."
    exec claude "$claude_cmd"
elif [[ "$mode" == "--foreground" ]]; then
    echo "Deploying team (foreground): ${team_display_name} [${deploy_id}]"
    exec claude --dangerously-skip-permissions "$claude_cmd"
else
    log_file="$LOGS_DIR/${team_name}-${deploy_id}.log"
    echo "Deploying team (background): ${team_display_name} [${deploy_id}]"
    echo "  Log: ${log_file}"
    echo "  Status: ./status.sh"

    # Max runtime before auto-kill (default: 30 minutes)
    max_runtime="${PA_MAX_RUNTIME:-1800}"

    # Write log header before claude starts (so log is never empty)
    cat > "$log_file" << LOG_HEADER
=== Deployment Log ===
Deployment: ${deploy_id}
Team:       ${team_name}
Started:    ${deploy_ts}
Timeout:    ${max_runtime}s
Primer:     ${primer_file}
Agents:     $(printf '%s ' "${agent_names[@]}")
===

LOG_HEADER

    nohup bash -c "
        echo '[$(date -Iseconds)] claude starting...' >> '${log_file}'

        # Start claude with timeout, stdout to log, stderr to separate file
        stdbuf -oL timeout '${max_runtime}' claude --dangerously-skip-permissions --print '$claude_cmd' >> '${log_file}' 2>'${log_file}.err'
        exit_code=\$?

        echo '' >> '${log_file}'
        echo '[$(date -Iseconds)] claude exited with code '\$exit_code >> '${log_file}'

        # Append stderr to main log if non-empty
        if [[ -s '${log_file}.err' ]]; then
            echo '' >> '${log_file}'
            echo '=== STDERR ===' >> '${log_file}'
            cat '${log_file}.err' >> '${log_file}'
        fi
        rm -f '${log_file}.err'

        # timeout returns 124 on timeout, 137 if killed
        if [[ \$exit_code -eq 124 ]]; then
            echo '[$(date -Iseconds)] TIMED OUT after ${max_runtime}s' >> '${log_file}'
            flock -w 5 '${REGISTRY_LOCK}' bash -c \"echo '{\\\"deployment_id\\\":\\\"${deploy_id}\\\",\\\"team\\\":\\\"${team_name}\\\",\\\"event\\\":\\\"crashed\\\",\\\"timestamp\\\":\\\"'\\\$(date -Iseconds)'\\\",\\\"exit_code\\\":124,\\\"summary\\\":\\\"Timed out after ${max_runtime}s\\\"}' >> '${REGISTRY_FILE}'\"
        elif [[ \$exit_code -ne 0 ]]; then
            flock -w 5 '${REGISTRY_LOCK}' bash -c \"echo '{\\\"deployment_id\\\":\\\"${deploy_id}\\\",\\\"team\\\":\\\"${team_name}\\\",\\\"event\\\":\\\"crashed\\\",\\\"timestamp\\\":\\\"'\\\$(date -Iseconds)'\\\",\\\"exit_code\\\":'\\\$exit_code'}' >> '${REGISTRY_FILE}'\"
        fi
    " > /dev/null 2>&1 &

    bg_pid=$!
    echo "  PID: ${bg_pid}"
    echo "  Timeout: ${max_runtime}s"

    # Update registry with PID (locked)
    registry_write "{\"deployment_id\":\"${deploy_id}\",\"team\":\"${team_name}\",\"event\":\"pid\",\"pid\":${bg_pid}}"
fi
