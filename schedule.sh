#!/usr/bin/env bash
set -euo pipefail

# Schedule a team deployment using systemd user timers
#
# Usage:
#   ./schedule.sh <team-name> <repeat> <time> [<time>...]
#   ./schedule.sh daily:<mode> <repeat> <time> [<time>...]
#
# Arguments:
#   team-name:  team YAML name (e.g., youtube-processor)
#               OR daily:<mode> for daily lifecycle (plan|progress|end)
#   repeat:     hourly | daily | weekly | monthly
#   time:       HH:MM — one or more times (multiple = multiple OnCalendar entries)
#
# Examples:
#   ./schedule.sh youtube-processor daily 09:00
#   ./schedule.sh daily:plan daily 08:00
#   ./schedule.sh daily:progress daily 10:00 12:00 14:00 16:00 18:00 20:00
#   ./schedule.sh daily:end daily 21:00

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PA_HOME="${PA_HOME:-$SCRIPT_DIR}"       # read-only base: teams/, skills/
PA_CONFIG=""                            # user overrides (set by pa-config.sh)
PA_DATA="${PA_DATA:-$PA_HOME}"          # mutable: primers/, logs/

# Load user config from ~/.config/sinh-x/personal-assistant/config.yaml
source "${PA_HOME}/pa-config.sh" 2>/dev/null || source "$SCRIPT_DIR/pa-config.sh" 2>/dev/null || true
# PA_BIN: when set (Nix install), use wrapped binaries; otherwise use scripts directly

# Resolve bash path at schedule-time (NixOS doesn't have /bin/bash)
BASH_PATH="$(command -v bash)"

spec="${1:?Usage: ./schedule.sh <team-name|daily:mode> <repeat> <time> [<time>...]}"
repeat="${2:?Specify repeat: hourly | daily | weekly | monthly}"
shift 2

# Collect times (default 09:00 if none given)
times=("${@:-09:00}")
if [[ ${#times[@]} -eq 0 ]]; then
    times=("09:00")
fi

# --- Determine exec command and unit name ---

if [[ "$spec" == daily:* ]]; then
    daily_mode="${spec#daily:}"
    if [[ ! "$daily_mode" =~ ^(plan|progress|end)$ ]]; then
        echo "Error: Invalid daily mode '$daily_mode'. Use: plan | progress | end" >&2
        exit 1
    fi
    if [[ -n "${PA_BIN:-}" ]]; then
        exec_cmd="${PA_BIN}/pa-daily ${daily_mode}"
    else
        exec_cmd="${BASH_PATH} \"${SCRIPT_DIR}/daily.sh\" \"${daily_mode}\""
    fi
    unit_name="pa-daily-${daily_mode}"
    description="personal-assistant daily ${daily_mode}"
else
    team_name="$spec"
    team_file=""
    if [[ -n "$PA_CONFIG" && -f "$PA_CONFIG/teams/${team_name}.yaml" ]]; then
        team_file="$PA_CONFIG/teams/${team_name}.yaml"
    elif [[ -f "$PA_HOME/teams/${team_name}.yaml" ]]; then
        team_file="$PA_HOME/teams/${team_name}.yaml"
    fi
    if [[ -z "$team_file" ]]; then
        echo "Error: Team not found: $team_name" >&2
        exit 1
    fi
    if [[ -n "${PA_BIN:-}" ]]; then
        exec_cmd="${PA_BIN}/pa-deploy ${team_name}"
    else
        exec_cmd="${BASH_PATH} \"${SCRIPT_DIR}/deploy.sh\" \"${team_name}\""
    fi
    unit_name="pa-${team_name}"
    description="personal-assistant deploy: ${team_name}"
fi

# --- Build OnCalendar lines ---

on_calendar_lines=""
time_display=""

for t in "${times[@]}"; do
    hour="${t%%:*}"
    min="${t##*:}"
    case "$repeat" in
        hourly)  cal="hourly" ;;
        daily)   cal="*-*-* ${hour}:${min}:00" ;;
        weekly)  cal="Mon *-*-* ${hour}:${min}:00" ;;
        monthly) cal="*-*-01 ${hour}:${min}:00" ;;
        *)       echo "Error: Invalid repeat: $repeat" >&2; exit 1 ;;
    esac
    on_calendar_lines="${on_calendar_lines}OnCalendar=${cal}
"
    time_display="${time_display} ${t}"
done

systemd_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
mkdir -p "$systemd_dir"

# --- Build environment lines for systemd ---

env_lines="Environment=HOME=${HOME}"
if [[ -n "${PA_HOME:-}" && "$PA_HOME" != "$SCRIPT_DIR" ]]; then
    env_lines="${env_lines}
Environment=PA_HOME=${PA_HOME}"
fi
if [[ -n "${PA_DATA:-}" && "$PA_DATA" != "$PA_HOME" ]]; then
    env_lines="${env_lines}
Environment=PA_DATA=${PA_DATA}"
fi
if [[ -n "${PA_BIN:-}" ]]; then
    env_lines="${env_lines}
Environment=PA_BIN=${PA_BIN}"
fi
# PA_CONFIG is no longer passed as env — scripts load from
# ~/.config/sinh-x/personal-assistant/config.yaml at runtime

# --- Write service unit ---

cat > "$systemd_dir/${unit_name}.service" << EOF
[Unit]
Description=${description}

[Service]
Type=oneshot
ExecStart=${exec_cmd}
KillMode=process
${env_lines}
EOF

# --- Write timer unit ---

cat > "$systemd_dir/${unit_name}.timer" << TIMER_EOF
[Unit]
Description=${description} (${repeat} at${time_display})

[Timer]
${on_calendar_lines}Persistent=true

[Install]
WantedBy=timers.target
TIMER_EOF

# --- Enable ---

systemctl --user daemon-reload
systemctl --user enable --now "${unit_name}.timer"

echo "Scheduled: ${unit_name} (${repeat} at${time_display})"
echo "Timer: ${unit_name}.timer"
echo ""
echo "Manage with:"
echo "  systemctl --user status ${unit_name}.timer"
echo "  systemctl --user list-timers '${unit_name}*'"
echo "  ./remove-timer.sh ${unit_name##pa-}"
