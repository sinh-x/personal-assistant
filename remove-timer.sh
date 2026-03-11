#!/usr/bin/env bash
set -euo pipefail

# Remove a scheduled team deployment
# Usage: ./remove-timer.sh <team-name>

team_name="${1:?Usage: ./remove-timer.sh <team-name>}"
unit_name="pa-${team_name}"
systemd_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

systemctl --user stop "${unit_name}.timer" 2>/dev/null || true
systemctl --user disable "${unit_name}.timer" 2>/dev/null || true
rm -f "$systemd_dir/${unit_name}.timer" "$systemd_dir/${unit_name}.service"
systemctl --user daemon-reload

echo "Removed timer: ${unit_name}"
