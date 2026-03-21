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

function __pa_modes
    # List deploy_modes IDs for the currently selected team.
    # Reads "  - id: <value>" lines from the team YAML — fast, no network (<200ms).
    set -l cmdline (commandline -opc)
    set -l team_name ""

    # Find the token after 'deploy' that isn't a flag
    set -l found_deploy false
    for token in $cmdline
        if $found_deploy
            if not string match -q -- '-*' $token
                set team_name $token
                break
            end
        end
        if test "$token" = deploy
            set found_deploy true
        end
    end

    if test -z "$team_name"
        return
    end

    # Locate the team YAML file using the same search order as __pa_teams
    set -l team_file ""
    if set -q PA_HOME; and test -f "$PA_HOME/teams/$team_name.yaml"
        set team_file "$PA_HOME/teams/$team_name.yaml"
    else if set -q PA_CONFIG; and test -f "$PA_CONFIG/teams/$team_name.yaml"
        set team_file "$PA_CONFIG/teams/$team_name.yaml"
    else
        set -l config_file ~/.config/sinh-x/personal-assistant/config.yaml
        if test -f "$config_file"
            set -l config_dir (string match -r '^config_dir:\s*(.+)' < "$config_file" | tail -1 | string trim)
            set config_dir (string replace '~' "$HOME" "$config_dir")
            if test -f "$config_dir/teams/$team_name.yaml"
                set team_file "$config_dir/teams/$team_name.yaml"
            end
        end
    end

    if test -z "$team_file"
        return
    end

    # Extract mode IDs: lines matching "  - id: <value>" (deploy_modes entries)
    grep -E '^\s+- id:' "$team_file" | sed 's/.*id:[[:space:]]*//'
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
complete -c pa -n __fish_use_subcommand -a teams        -d 'List available teams'
complete -c pa -n __fish_use_subcommand -a deploy       -d 'Deploy an agent team'
complete -c pa -n __fish_use_subcommand -a daily        -d 'Daily lifecycle (plan|progress|end)'
complete -c pa -n __fish_use_subcommand -a status       -d 'Show deployment status'
complete -c pa -n __fish_use_subcommand -a schedule     -d 'Schedule a team with systemd timers'
complete -c pa -n __fish_use_subcommand -a timers       -d 'List scheduled timers'
complete -c pa -n __fish_use_subcommand -a remove-timer -d 'Remove a scheduled timer'
complete -c pa -n __fish_use_subcommand -a idea         -d 'Log an idea interactively'
complete -c pa -n __fish_use_subcommand -a report       -d 'Submit a bug report, feature request, or feedback'
complete -c pa -n __fish_use_subcommand -a repos        -d 'Manage repository roots registry'
complete -c pa -n __fish_use_subcommand -a requirements -d 'Requirements lifecycle (ideas)'

# --- deploy: <team> + flags ---
complete -c pa -n '__fish_seen_subcommand_from deploy; and not __fish_seen_subcommand_from (__pa_teams)' -a '(__pa_teams)' -d 'Team name'
complete -c pa -n '__fish_seen_subcommand_from deploy' -l dry-run        -d 'Generate primer and print it, no execution'
complete -c pa -n '__fish_seen_subcommand_from deploy' -l background     -d 'Run in background'
complete -c pa -n '__fish_seen_subcommand_from deploy' -l interactive    -d 'Run in foreground, user approves each tool call'
complete -c pa -n '__fish_seen_subcommand_from deploy' -l direct         -d 'Lightweight direct mode — no sub-agents, skip-permissions'
complete -c pa -n '__fish_seen_subcommand_from deploy' -l objective      -d 'Append extra instructions' -r
complete -c pa -n '__fish_seen_subcommand_from deploy' -l mode           -d 'Deploy using a specific mode' -r -a '(__pa_modes)'
complete -c pa -n '__fish_seen_subcommand_from deploy' -l list-modes     -d 'List available modes for the team and exit'
complete -c pa -n '__fish_seen_subcommand_from deploy' -l team-model     -d 'Model for the team-manager (haiku|sonnet|opus)' -r -a 'haiku sonnet opus'
complete -c pa -n '__fish_seen_subcommand_from deploy' -l agent-model    -d 'Model for all named agents (haiku|sonnet|opus)' -r -a 'haiku sonnet opus'
complete -c pa -n '__fish_seen_subcommand_from deploy' -l repo           -d 'Target repo name from repos.yaml' -r

# --- daily: <mode> + flags ---
complete -c pa -n '__fish_seen_subcommand_from daily; and not __fish_seen_subcommand_from plan progress end' -a 'plan progress end' -d 'Daily mode'
complete -c pa -n '__fish_seen_subcommand_from daily' -l dry-run     -d 'Generate primer and print it, no execution'
complete -c pa -n '__fish_seen_subcommand_from daily' -l background  -d 'Run in background'
complete -c pa -n '__fish_seen_subcommand_from daily' -l interactive -d 'Run in foreground, user approves each tool call'
complete -c pa -n '__fish_seen_subcommand_from daily' -l review      -d 'Interactive review mode (end=review+synthesize, plan=finalize draft)'

# --- status: [deploy-id] + flags ---
complete -c pa -n '__fish_seen_subcommand_from status; and not __fish_seen_subcommand_from (__pa_deploy_ids)' -a '(__pa_deploy_ids)' -d 'Deployment ID'
complete -c pa -n '__fish_seen_subcommand_from status' -l running   -d 'Show only running deployments'
complete -c pa -n '__fish_seen_subcommand_from status' -l team      -d 'Filter by team name' -r -a '(__pa_teams)'
complete -c pa -n '__fish_seen_subcommand_from status' -l wait      -d 'Block until deployment reaches a terminal state'
complete -c pa -n '__fish_seen_subcommand_from status' -l report    -d 'Show the work report for a deployment'
complete -c pa -n '__fish_seen_subcommand_from status' -l artifacts -d 'List artifact files for a deployment'
complete -c pa -n '__fish_seen_subcommand_from status' -l activity  -d 'Show agent activity timeline for a deployment'

# --- schedule: <spec> <repeat> ---
complete -c pa -n '__fish_seen_subcommand_from schedule; and test (count (commandline -opc)) -eq 2' -a '(__pa_teams) daily:plan daily:progress daily:end' -d 'Team or daily:<mode>'
complete -c pa -n '__fish_seen_subcommand_from schedule; and test (count (commandline -opc)) -eq 3' -a 'hourly daily weekly monthly' -d 'Repeat interval'

# --- remove-timer: <name> ---
complete -c pa -n '__fish_seen_subcommand_from remove-timer' -a '(__pa_timer_names)' -d 'Timer to remove'

# --- repos: <subcommand> ---
complete -c pa -n '__fish_seen_subcommand_from repos; and not __fish_seen_subcommand_from list' -a 'list' -d 'List registered repos'

# --- requirements: <mode> + flags ---
complete -c pa -n '__fish_seen_subcommand_from requirements; and not __fish_seen_subcommand_from ideas' -a 'ideas' -d 'Requirements mode'
complete -c pa -n '__fish_seen_subcommand_from requirements' -l force       -d 'Re-triage all ideas, not just new ones'
complete -c pa -n '__fish_seen_subcommand_from requirements' -l dry-run     -d 'Generate primer and print it, no execution'
complete -c pa -n '__fish_seen_subcommand_from requirements' -l background  -d 'Run in background'
complete -c pa -n '__fish_seen_subcommand_from requirements' -l interactive -d 'Run in foreground, user approves each tool call'
