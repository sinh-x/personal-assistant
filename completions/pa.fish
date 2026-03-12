# Fish completions for pa (personal-assistant CLI)

# --- Helper functions ---

function __pa_teams
    # List team names from PA_HOME/teams/ and PA_CONFIG/teams/
    set -l dirs

    # PA_HOME teams (set by Nix wrapper)
    if set -q PA_HOME; and test -d "$PA_HOME/teams"
        set -a dirs "$PA_HOME/teams"
    end

    # PA_CONFIG teams (from config.yaml or env var)
    if set -q PA_CONFIG; and test -d "$PA_CONFIG/teams"
        set -a dirs "$PA_CONFIG/teams"
    else
        # Parse config_dir from config.yaml
        set -l config_file ~/.config/sinh-x/personal-assistant/config.yaml
        if test -f "$config_file"
            set -l config_dir (string match -r '^config_dir:\s*(.+)' < "$config_file" | tail -1 | string trim)
            # Expand ~ prefix
            set config_dir (string replace '~' "$HOME" "$config_dir")
            if test -d "$config_dir/teams"
                set -a dirs "$config_dir/teams"
            end
        end
    end

    # List .yaml files, strip extension, deduplicate
    for dir in $dirs
        for f in $dir/*.yaml
            if test -f "$f"
                basename "$f" .yaml
            end
        end
    end | sort -u
end

function __pa_deploy_ids
    # List deployment IDs from registry.jsonl
    set -l registry ~/Documents/ai-usage/deployments/registry.jsonl
    if test -f "$registry"
        string match -r '"deployment_id":"(d-[0-9a-f]+)"' < "$registry" | string match -r 'd-[0-9a-f]+' | sort -u
    end
end

function __pa_timer_names
    # List removable pa-* timer names (strip pa- prefix and .timer suffix)
    systemctl --user list-timers 'pa-*' --no-legend 2>/dev/null | string match -r 'pa-\S+\.timer' | string replace -r '^pa-' '' | string replace -r '\.timer$' '' | sort -u
end

# --- Disable file completions for pa ---
complete -c pa -f

# --- Subcommands ---
complete -c pa -n __fish_use_subcommand -a teams -d 'List available teams'
complete -c pa -n __fish_use_subcommand -a deploy -d 'Deploy an agent team'
complete -c pa -n __fish_use_subcommand -a daily -d 'Daily lifecycle (plan|progress|end)'
complete -c pa -n __fish_use_subcommand -a status -d 'Show deployment status'
complete -c pa -n __fish_use_subcommand -a schedule -d 'Schedule a team with systemd timers'
complete -c pa -n __fish_use_subcommand -a timers -d 'List scheduled timers'
complete -c pa -n __fish_use_subcommand -a remove-timer -d 'Remove a scheduled timer'
complete -c pa -n __fish_use_subcommand -a idea -d 'Log an idea interactively'

# --- deploy: <team> + flags ---
complete -c pa -n '__fish_seen_subcommand_from deploy; and not __fish_seen_subcommand_from (__pa_teams)' -a '(__pa_teams)' -d 'Team name'
complete -c pa -n '__fish_seen_subcommand_from deploy' -l dry-run -d 'Generate primer and print it, no execution'
complete -c pa -n '__fish_seen_subcommand_from deploy' -l background -d 'Run in background'
complete -c pa -n '__fish_seen_subcommand_from deploy' -l interactive -d 'Run in foreground, user approves each tool call'
complete -c pa -n '__fish_seen_subcommand_from deploy' -l objective -d 'Append extra instructions' -r

# --- daily: <mode> + flags ---
complete -c pa -n '__fish_seen_subcommand_from daily; and not __fish_seen_subcommand_from plan progress end' -a 'plan progress end' -d 'Daily mode'
complete -c pa -n '__fish_seen_subcommand_from daily' -l dry-run -d 'Generate primer and print it, no execution'
complete -c pa -n '__fish_seen_subcommand_from daily' -l background -d 'Run in background'
complete -c pa -n '__fish_seen_subcommand_from daily' -l interactive -d 'Run in foreground, user approves each tool call'

# --- status: [deploy-id] + flags ---
complete -c pa -n '__fish_seen_subcommand_from status; and not __fish_seen_subcommand_from (__pa_deploy_ids)' -a '(__pa_deploy_ids)' -d 'Deployment ID'
complete -c pa -n '__fish_seen_subcommand_from status' -l running -d 'Show only running deployments'
complete -c pa -n '__fish_seen_subcommand_from status' -l team -d 'Filter by team name' -r -a '(__pa_teams)'

# --- schedule: <spec> <repeat> ---
complete -c pa -n '__fish_seen_subcommand_from schedule; and test (count (commandline -opc)) -eq 2' -a '(__pa_teams) daily:plan daily:progress daily:end' -d 'Team or daily:<mode>'
complete -c pa -n '__fish_seen_subcommand_from schedule; and test (count (commandline -opc)) -eq 3' -a 'hourly daily weekly monthly' -d 'Repeat interval'

# --- remove-timer: <name> ---
complete -c pa -n '__fish_seen_subcommand_from remove-timer' -a '(__pa_timer_names)' -d 'Timer to remove'
