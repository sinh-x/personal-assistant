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

function __pa_deployments_with_team
    # List deployments as "team/deployment_id" with summary as description.
    # Format: "team/id\tsummary" for fish's -d flag display.
    # Uses Python for portable JSON parsing; prefer entries with summaries.
    set -l registry ~/Documents/ai-usage/deployments/registry.jsonl
    if test -f "$registry"
        python3 -c "
import sys, json
# First pass: collect summaries (prefer completed events which have summaries)
entries = {}
for line in open('$registry'):
    try:
        entry = json.loads(line.strip())
        if 'deployment_id' in entry and 'team' in entry:
            dep_id = entry.get('deployment_id', '')
            team = entry.get('team', '')
            summary = entry.get('summary', '')
            if dep_id not in entries or (summary and not entries[dep_id][1]):
                entries[dep_id] = (team, summary[:80] if summary else '')
    except:
        pass
# Output in deployment_id order for consistency
for dep_id in sorted(entries.keys()):
    team, summary = entries[dep_id]
    summary_disp = summary if summary else '(no summary)'
    print(f'{team}/{dep_id}\t{summary_disp}')
" 2>/dev/null
    end
end

function __pa_timer_names
    # List removable pa-* timer names (strip pa- prefix and .timer suffix)
    systemctl --user list-timers 'pa-*' --no-legend 2>/dev/null | string match -r 'pa-\S+\.timer' | string replace -r '^pa-' '' | string replace -r '\.timer$' '' | sort -u
end

function __pa_projects
    # List project names from 'pa repos list'. Parse the NAME column (skip 2 header lines).
    pa repos list 2>/dev/null | awk 'NR>2 && NF>0 {print $1}'
end

function __pa_ticket_ids
    # List active ticket IDs with title as description. Skip header (2 lines) and summary line.
    pa ticket list 2>/dev/null | awk 'NR>2 && /^[A-Z]/ {
        id = $1;
        title = "";
        for (i=6; i<=NF; i++) title = title (i>6?" ":"") $i;
        print id "\t" title
    }'
end

function __pa_bulletin_ids
    # List active bulletin IDs from 'pa bulletin list'. Format in output: [B-001].
    pa bulletin list 2>/dev/null | string match -rg '\[([A-Z]+-[0-9]+)\]'
end

function __pa_trash_ids
    # List trash entry IDs from 'pa trash list'. Format: T-001, T-002, etc.
    pa trash list 2>/dev/null | string match -rg '^T-[0-9]+'
end

function __pa_assignees
    # Combine unique assignees from active tickets + team names.
    # Filter column 5 to only valid assignee tokens (no overflow artifacts from long names).
    set -l from_tickets (pa ticket list 2>/dev/null | awk 'NR>2 && /^[A-Z]/ {print $5}' | grep -E '^[a-z][a-z0-9/_-]*$')
    set -l from_teams (__pa_teams)
    printf '%s\n' $from_tickets $from_teams | sort -u
end

# --- Disable file completions for pa ---
complete -c pa -f

# --- Subcommands ---
complete -c pa -n __fish_use_subcommand -a teams        -d 'List available teams'
complete -c pa -n __fish_use_subcommand -a board        -d 'Show kanban board'
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
complete -c pa -n __fish_use_subcommand -a serve        -d 'Start the agent API server'
complete -c pa -n __fish_use_subcommand -a ticket       -d 'Manage tickets'
complete -c pa -n __fish_use_subcommand -a bulletin     -d 'Manage bulletins (deploy-time blockers)'
complete -c pa -n __fish_use_subcommand -a registry     -d 'Manage deployment registry'
complete -c pa -n __fish_use_subcommand -a trash        -d 'Soft-delete PA project files'

# --- deploy: <team> + flags ---
complete -c pa -n '__fish_seen_subcommand_from deploy; and not __fish_seen_subcommand_from (__pa_teams)' -a '(__pa_teams)' -d 'Team name'
complete -c pa -n '__fish_seen_subcommand_from deploy' -l dry-run        -d 'Generate primer and print it, no execution'
complete -c pa -n '__fish_seen_subcommand_from deploy' -l background     -d 'Run in background'
complete -c pa -n '__fish_seen_subcommand_from deploy' -l interactive    -d 'Run in foreground, user approves each tool call'
complete -c pa -n '__fish_seen_subcommand_from deploy' -l direct         -d 'Lightweight direct mode — no sub-agents, skip-permissions'
complete -c pa -n '__fish_seen_subcommand_from deploy' -l objective      -d 'Append extra instructions (use team name as prefix, e.g. builder:...)' -r -a 'builder: requirement: maintenance: secretary:'
complete -c pa -n '__fish_seen_subcommand_from deploy' -l mode           -d 'Deploy using a specific mode' -r -a '(__pa_modes)'
complete -c pa -n '__fish_seen_subcommand_from deploy' -l list-modes     -d 'List available modes for the team and exit'
complete -c pa -n '__fish_seen_subcommand_from deploy' -l team-model     -d 'Model for the team-manager (haiku|sonnet|opus)' -r -a 'haiku sonnet opus'
complete -c pa -n '__fish_seen_subcommand_from deploy' -l agent-model    -d 'Model for all named agents (haiku|sonnet|opus)' -r -a 'haiku sonnet opus'
complete -c pa -n '__fish_seen_subcommand_from deploy' -l repo           -d 'Target repo name from repos.yaml' -r
complete -c pa -n '__fish_seen_subcommand_from deploy' -l ticket        -d 'Link deployment to a ticket' -r -a '(__pa_ticket_ids)'
complete -c pa -n '__fish_seen_subcommand_from deploy' -l validate       -d 'Validate team config, skill files, mode files, and template variables without deploying'
complete -c pa -n '__fish_seen_subcommand_from deploy' -l provider      -d 'API provider (anthropic or minimax)' -r -a 'anthropic minimax'

# --- daily: <mode> + flags ---
complete -c pa -n '__fish_seen_subcommand_from daily; and not __fish_seen_subcommand_from plan progress end' -a 'plan progress end' -d 'Daily mode'
complete -c pa -n '__fish_seen_subcommand_from daily' -l dry-run     -d 'Generate primer and print it, no execution'
complete -c pa -n '__fish_seen_subcommand_from daily' -l background  -d 'Run in background'
complete -c pa -n '__fish_seen_subcommand_from daily' -l interactive -d 'Run in foreground, user approves each tool call'
complete -c pa -n '__fish_seen_subcommand_from daily' -l review      -d 'Interactive review mode (end=review+synthesize, plan=finalize draft)'

# --- status: [deploy-id] + flags ---
complete -c pa -n '__fish_seen_subcommand_from status; and not __fish_seen_subcommand_from (__pa_deployments_with_team)' -a '(__pa_deployments_with_team)' -d 'Deployment (team/id — summary)'
complete -c pa -n '__fish_seen_subcommand_from status' -l running   -d 'Show only running deployments'
complete -c pa -n '__fish_seen_subcommand_from status' -l team      -d 'Filter by team name' -r -a '(__pa_teams)'
complete -c pa -n '__fish_seen_subcommand_from status' -l wait      -d 'Block until deployment reaches a terminal state'
complete -c pa -n '__fish_seen_subcommand_from status' -l report    -d 'Show the work report for a deployment'
complete -c pa -n '__fish_seen_subcommand_from status' -l artifacts -d 'List artifact files for a deployment'
complete -c pa -n '__fish_seen_subcommand_from status' -l activity  -d 'Show agent activity timeline for a deployment'
complete -c pa -n '__fish_seen_subcommand_from status' -l recent    -d 'Show only the N most recent deployments' -r
complete -c pa -n '__fish_seen_subcommand_from status' -l today     -d 'Show only today\'s deployments'

# --- schedule: <spec> <repeat> ---
complete -c pa -n '__fish_seen_subcommand_from schedule; and test (count (commandline -opc)) -eq 2' -a '(__pa_teams) daily:plan daily:progress daily:end requirements:ideas' -d 'Team, daily:<mode>, or requirements:<mode>'
complete -c pa -n '__fish_seen_subcommand_from schedule; and test (count (commandline -opc)) -eq 3' -a 'hourly daily weekly monthly' -d 'Repeat interval'

# --- remove-timer: <name> ---
complete -c pa -n '__fish_seen_subcommand_from remove-timer' -a '(__pa_timer_names)' -d 'Timer to remove'

# --- teams: <name> + flags ---
complete -c pa -n '__fish_seen_subcommand_from teams; and not __fish_seen_subcommand_from (__pa_teams)' -a '(__pa_teams)' -d 'Team name'
complete -c pa -n '__fish_seen_subcommand_from teams' -l all -d 'Show all tickets including backlog, archived, and terminal'

# --- repos: <subcommand> ---
complete -c pa -n '__fish_seen_subcommand_from repos; and not __fish_seen_subcommand_from list' -a 'list' -d 'List registered repos'

# --- requirements: <mode> + flags ---
complete -c pa -n '__fish_seen_subcommand_from requirements; and not __fish_seen_subcommand_from ideas' -a 'ideas' -d 'Requirements mode'
complete -c pa -n '__fish_seen_subcommand_from requirements' -l force       -d 'Re-triage all ideas, not just new ones'
complete -c pa -n '__fish_seen_subcommand_from requirements' -l dry-run     -d 'Generate primer and print it, no execution'
complete -c pa -n '__fish_seen_subcommand_from requirements' -l background  -d 'Run in background'
complete -c pa -n '__fish_seen_subcommand_from requirements' -l interactive -d 'Run in foreground, user approves each tool call'

# --- board: flags ---
complete -c pa -n '__fish_seen_subcommand_from board' -l all       -d 'Show all tickets including backlog, archived, and terminal'
complete -c pa -n '__fish_seen_subcommand_from board' -l project  -d 'Filter by project' -r -a '(__pa_projects)'
complete -c pa -n '__fish_seen_subcommand_from board' -l assignee -d 'Filter by assignee' -r -a '(__pa_assignees)'

# --- serve: flags ---
complete -c pa -n '__fish_seen_subcommand_from serve' -l port       -d 'Port to listen on' -r
complete -c pa -n '__fish_seen_subcommand_from serve' -l host       -d 'Host address to bind to' -r
complete -c pa -n '__fish_seen_subcommand_from serve' -l background -d 'Run in background mode'
complete -c pa -n '__fish_seen_subcommand_from serve' -l cors       -d 'Enable CORS headers'

# --- ticket: nested subcommands ---
complete -c pa -n '__fish_seen_subcommand_from ticket; and not __fish_seen_subcommand_from create update list show attach comment' -a 'create update list show attach comment'

# ticket create
complete -c pa -n '__fish_seen_subcommand_from ticket; and __fish_seen_subcommand_from create' -l project  -d 'Project name (key from repos.yaml)' -r -a '(__pa_projects)'
complete -c pa -n '__fish_seen_subcommand_from ticket; and __fish_seen_subcommand_from create' -l title    -d 'Ticket title' -r
complete -c pa -n '__fish_seen_subcommand_from ticket; and __fish_seen_subcommand_from create' -l type     -d 'Ticket type' -r -a 'feature bug task review-request work-report fyi idea question'
complete -c pa -n '__fish_seen_subcommand_from ticket; and __fish_seen_subcommand_from create' -l assignee -d 'Assignee' -r -a '(__pa_assignees)'
complete -c pa -n '__fish_seen_subcommand_from ticket; and __fish_seen_subcommand_from create' -l priority -d 'Priority' -r -a 'critical high medium low'
complete -c pa -n '__fish_seen_subcommand_from ticket; and __fish_seen_subcommand_from create' -l estimate -d 'Effort estimate' -r -a 'XS S M L XL'
complete -c pa -n '__fish_seen_subcommand_from ticket; and __fish_seen_subcommand_from create' -l summary  -d 'Short summary' -r
complete -c pa -n '__fish_seen_subcommand_from ticket; and __fish_seen_subcommand_from create' -l tags     -d 'Comma-separated tags' -r
complete -c pa -n '__fish_seen_subcommand_from ticket; and __fish_seen_subcommand_from create' -l doc-ref  -d 'Document reference path' -r
complete -c pa -n '__fish_seen_subcommand_from ticket; and __fish_seen_subcommand_from create' -l actor    -d 'Actor for audit log' -r

# ticket update <ID>
complete -c pa -n '__fish_seen_subcommand_from ticket; and __fish_seen_subcommand_from update; and not __fish_seen_subcommand_from (__pa_ticket_ids)' -a '(__pa_ticket_ids)' -d 'Ticket ID'
complete -c pa -n '__fish_seen_subcommand_from ticket; and __fish_seen_subcommand_from update' -l status   -d 'New status' -r -a 'idea requirement-review pending-approval pending-implementation implementing review-uat done rejected cancelled'
complete -c pa -n '__fish_seen_subcommand_from ticket; and __fish_seen_subcommand_from update' -l assignee -d 'New assignee' -r -a '(__pa_assignees)'
complete -c pa -n '__fish_seen_subcommand_from ticket; and __fish_seen_subcommand_from update' -l priority -d 'New priority' -r -a 'critical high medium low'
complete -c pa -n '__fish_seen_subcommand_from ticket; and __fish_seen_subcommand_from update' -l estimate -d 'New estimate' -r -a 'XS S M L XL'
complete -c pa -n '__fish_seen_subcommand_from ticket; and __fish_seen_subcommand_from update' -l tags     -d 'Comma-separated tags (replaces existing)' -r
complete -c pa -n '__fish_seen_subcommand_from ticket; and __fish_seen_subcommand_from update' -l blocked-by -d 'Comma-separated blocking ticket IDs (empty to clear)' -r
complete -c pa -n '__fish_seen_subcommand_from ticket; and __fish_seen_subcommand_from update' -l doc-ref         -d 'Add document reference: [type:]path' -r
complete -c pa -n '__fish_seen_subcommand_from ticket; and __fish_seen_subcommand_from update' -l doc-ref-primary  -d 'Mark the added doc-ref as primary'
complete -c pa -n '__fish_seen_subcommand_from ticket; and __fish_seen_subcommand_from update' -l remove-doc-ref   -d 'Remove a doc-ref by exact path match' -r
complete -c pa -n '__fish_seen_subcommand_from ticket; and __fish_seen_subcommand_from update' -l actor    -d 'Actor for audit log' -r

# ticket list
complete -c pa -n '__fish_seen_subcommand_from ticket; and __fish_seen_subcommand_from list' -l project       -d 'Filter by project' -r -a '(__pa_projects)'
complete -c pa -n '__fish_seen_subcommand_from ticket; and __fish_seen_subcommand_from list' -l status        -d 'Filter by status' -r -a 'idea requirement-review pending-approval pending-implementation implementing review-uat done rejected cancelled'
complete -c pa -n '__fish_seen_subcommand_from ticket; and __fish_seen_subcommand_from list' -l assignee      -d 'Filter by assignee' -r -a '(__pa_assignees)'
complete -c pa -n '__fish_seen_subcommand_from ticket; and __fish_seen_subcommand_from list' -l priority      -d 'Filter by priority' -r -a 'critical high medium low'
complete -c pa -n '__fish_seen_subcommand_from ticket; and __fish_seen_subcommand_from list' -l type          -d 'Filter by type' -r -a 'feature bug task review-request work-report fyi idea question'
complete -c pa -n '__fish_seen_subcommand_from ticket; and __fish_seen_subcommand_from list' -l tags          -d 'Filter by tags (comma-separated, AND logic)' -r
complete -c pa -n '__fish_seen_subcommand_from ticket; and __fish_seen_subcommand_from list' -l exclude-tags  -d 'Exclude tickets with any of these tags (comma-separated)' -r
complete -c pa -n '__fish_seen_subcommand_from ticket; and __fish_seen_subcommand_from list' -l search        -d 'Free-text search on ticket ID, title, and summary' -r

# ticket show <ID>
complete -c pa -n '__fish_seen_subcommand_from ticket; and __fish_seen_subcommand_from show; and not __fish_seen_subcommand_from (__pa_ticket_ids)' -a '(__pa_ticket_ids)' -d 'Ticket ID'
complete -c pa -n '__fish_seen_subcommand_from ticket; and __fish_seen_subcommand_from show' -l json -d 'Output raw JSON instead of formatted card'

# ticket attach <ID>
complete -c pa -n '__fish_seen_subcommand_from ticket; and __fish_seen_subcommand_from attach; and not __fish_seen_subcommand_from (__pa_ticket_ids)' -a '(__pa_ticket_ids)' -d 'Ticket ID'
complete -c pa -n '__fish_seen_subcommand_from ticket; and __fish_seen_subcommand_from attach' -l file  -d 'File path or doc-ref to attach' -r
complete -c pa -n '__fish_seen_subcommand_from ticket; and __fish_seen_subcommand_from attach' -l actor -d 'Actor for audit log' -r

# ticket comment <ID>
complete -c pa -n '__fish_seen_subcommand_from ticket; and __fish_seen_subcommand_from comment; and not __fish_seen_subcommand_from (__pa_ticket_ids)' -a '(__pa_ticket_ids)' -d 'Ticket ID'
complete -c pa -n '__fish_seen_subcommand_from ticket; and __fish_seen_subcommand_from comment' -l author  -d 'Comment author' -r
complete -c pa -n '__fish_seen_subcommand_from ticket; and __fish_seen_subcommand_from comment' -l content -d 'Comment content' -r

# --- bulletin: nested subcommands ---
complete -c pa -n '__fish_seen_subcommand_from bulletin; and not __fish_seen_subcommand_from create list resolve' -a 'create list resolve'

# bulletin create
complete -c pa -n '__fish_seen_subcommand_from bulletin; and __fish_seen_subcommand_from create' -l title   -d 'Bulletin title' -r
complete -c pa -n '__fish_seen_subcommand_from bulletin; and __fish_seen_subcommand_from create' -l block   -d 'Teams to block ("all" or comma-separated)' -r -a 'all (__pa_teams)'
complete -c pa -n '__fish_seen_subcommand_from bulletin; and __fish_seen_subcommand_from create' -l except  -d 'Comma-separated teams exempt from bulletin' -r -a '(__pa_teams)'
complete -c pa -n '__fish_seen_subcommand_from bulletin; and __fish_seen_subcommand_from create' -l message -d 'Bulletin body message' -r

# bulletin resolve <ID>
complete -c pa -n '__fish_seen_subcommand_from bulletin; and __fish_seen_subcommand_from resolve; and not __fish_seen_subcommand_from (__pa_bulletin_ids)' -a '(__pa_bulletin_ids)' -d 'Bulletin ID'

# --- registry: nested subcommands ---
complete -c pa -n '__fish_seen_subcommand_from registry; and not __fish_seen_subcommand_from complete' -a 'complete'

# registry complete <deploy-id>
complete -c pa -n '__fish_seen_subcommand_from registry; and __fish_seen_subcommand_from complete; and not __fish_seen_subcommand_from (__pa_deploy_ids)' -a '(__pa_deploy_ids)' -d 'Deployment ID'
complete -c pa -n '__fish_seen_subcommand_from registry; and __fish_seen_subcommand_from complete' -l status   -d 'Completion status' -r -a 'success partial failed'
complete -c pa -n '__fish_seen_subcommand_from registry; and __fish_seen_subcommand_from complete' -l summary  -d 'One-line summary of what was done' -r
complete -c pa -n '__fish_seen_subcommand_from registry; and __fish_seen_subcommand_from complete' -l log-file -d 'Session log file path (optional)' -r
complete -c pa -n '__fish_seen_subcommand_from registry; and __fish_seen_subcommand_from complete' -l rating-source -d 'Rating source' -r -a 'agent system user'
complete -c pa -n '__fish_seen_subcommand_from registry; and __fish_seen_subcommand_from complete' -l rating-overall -d 'Overall rating (0-5)' -r
complete -c pa -n '__fish_seen_subcommand_from registry; and __fish_seen_subcommand_from complete' -l rating-productivity -d 'Productivity rating (0-5)' -r
complete -c pa -n '__fish_seen_subcommand_from registry; and __fish_seen_subcommand_from complete' -l rating-quality -d 'Quality rating (0-5)' -r
complete -c pa -n '__fish_seen_subcommand_from registry; and __fish_seen_subcommand_from complete' -l rating-efficiency -d 'Efficiency rating (0-5)' -r
complete -c pa -n '__fish_seen_subcommand_from registry; and __fish_seen_subcommand_from complete' -l rating-insight -d 'Insight rating (0-5)' -r

# --- trash: nested subcommands ---
complete -c pa -n '__fish_seen_subcommand_from trash; and not __fish_seen_subcommand_from move list show restore purge' -a 'move list show restore purge'

# trash move <path>
complete -c pa -n '__fish_seen_subcommand_from trash; and __fish_seen_subcommand_from move' -l reason -d 'Why this file is being trashed' -r
complete -c pa -n '__fish_seen_subcommand_from trash; and __fish_seen_subcommand_from move' -l actor  -d 'Who is trashing it' -r
complete -c pa -n '__fish_seen_subcommand_from trash; and __fish_seen_subcommand_from move' -l type   -d 'File type' -r -a 'skill team objective mode other'
complete -c pa -n '__fish_seen_subcommand_from trash; and __fish_seen_subcommand_from move' -F

# trash list
complete -c pa -n '__fish_seen_subcommand_from trash; and __fish_seen_subcommand_from list' -l status -d 'Filter by status' -r -a 'trashed restored purged'
complete -c pa -n '__fish_seen_subcommand_from trash; and __fish_seen_subcommand_from list' -l type   -d 'Filter by file type' -r -a 'skill team objective mode other'
complete -c pa -n '__fish_seen_subcommand_from trash; and __fish_seen_subcommand_from list' -l search -d 'Free-text search' -r

# trash show <id>
complete -c pa -n '__fish_seen_subcommand_from trash; and __fish_seen_subcommand_from show; and not __fish_seen_subcommand_from (__pa_trash_ids)' -a '(__pa_trash_ids)' -d 'Trash ID'

# trash restore <id>
complete -c pa -n '__fish_seen_subcommand_from trash; and __fish_seen_subcommand_from restore; and not __fish_seen_subcommand_from (__pa_trash_ids)' -a '(__pa_trash_ids)' -d 'Trash ID'
complete -c pa -n '__fish_seen_subcommand_from trash; and __fish_seen_subcommand_from restore' -l force -d 'Overwrite if original path exists'
complete -c pa -n '__fish_seen_subcommand_from trash; and __fish_seen_subcommand_from restore' -l actor -d 'Who is restoring' -r

# trash purge
complete -c pa -n '__fish_seen_subcommand_from trash; and __fish_seen_subcommand_from purge' -l days    -d 'Retention period in days' -r
complete -c pa -n '__fish_seen_subcommand_from trash; and __fish_seen_subcommand_from purge' -l dry-run -d 'Show what would be purged without deleting'
complete -c pa -n '__fish_seen_subcommand_from trash; and __fish_seen_subcommand_from purge' -l actor   -d 'Who is purging' -r
