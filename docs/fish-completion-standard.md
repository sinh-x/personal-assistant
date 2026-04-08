# Fish Completion Standard — `pa` CLI

This document is the authoritative guide for maintaining and extending fish shell completions for the `pa` CLI.

---

## File Location & Installation

| Item | Path |
|------|------|
| Source file | `completions/pa.fish` (single file — all completions here) |
| Installed via | `flake.nix` → `share/fish/vendor_completions.d/pa.fish` |
| Installed path | `~/.nix-profile/share/fish/vendor_completions.d/pa.fish` |

Fish loads vendor completions automatically on shell start. No manual `source` needed after a Nix rebuild.

---

## Checklist: Adding Completions for a New Command

When you add a new `pa` command, complete **all** of these steps before merging:

- [ ] Add subcommand entry: `complete -c pa -n __fish_use_subcommand -a <cmd> -d '<description>'`
- [ ] Add flags for the command (all `--flags` with types, descriptions, and dynamic/enum completions)
- [ ] Add dynamic helpers for any argument that maps to a list (ticket IDs, project names, etc.)
- [ ] Add enum completions for all typed flags (status, type, priority, estimate)
- [ ] Update `skills/global/standards/cli-reference.md` — add the command to the cheat sheet table
- [ ] Update `docs/commands.md` — add the full command reference section (synopsis, flags, examples)

---

## Helper Function Conventions

| Convention | Rule |
|------------|------|
| **Naming** | `__pa_<resource>` (e.g. `__pa_teams`, `__pa_ticket_ids`, `__pa_projects`) |
| **Performance** | Complete in `<500ms` — avoid slow operations, no network calls that can block |
| **Silent failure** | Redirect stderr to `/dev/null`; return nothing if `pa` CLI is unavailable |
| **Output format** | One item per line; use `\t` to separate value from description for `-d` display |
| **Deduplication** | Pipe through `sort -u` when combining multiple sources |

### Existing helpers

| Helper | Returns |
|--------|---------|
| `__pa_teams` | Team names from `PA_HOME/teams/` and `PA_CONFIG/teams/` (reads YAML files) |
| `__pa_modes` | Deploy mode IDs for the currently selected team (reads team YAML) |
| `__pa_deploy_ids` | Deployment IDs from SQLite registry (fallback: `registry.jsonl`) |
| `__pa_timer_names` | Active `pa-*` systemd timer names |
| `__pa_projects` | Project names from `pa repos list` (NAME column) |
| `__pa_ticket_ids` | Active ticket IDs with title description from `pa ticket list` |
| `__pa_bulletin_ids` | Active bulletin IDs from `pa bulletin list` |
| `__pa_assignees` | Unique assignees from active tickets + team names |

---

## Testing Completions

### Reload without rebuilding Nix

```fish
source completions/pa.fish
```

### Verify a completion

```fish
# Check subcommand list
pa <TAB>

# Check flag completions
pa ticket create --<TAB>
pa ticket update PA-916 --status <TAB>

# Check dynamic completions (requires pa CLI in PATH)
pa ticket update <TAB>          # shows active ticket IDs
pa board --project <TAB>        # shows project names
pa bulletin resolve <TAB>       # shows active bulletin IDs
```

### Syntax check (no-execute parse)

```fish
fish --no-execute completions/pa.fish
```

A clean exit (no output) means the file is syntactically valid.

---

## Template: Adding a Simple Subcommand

```fish
# --- <cmd>: flags ---
complete -c pa -n __fish_use_subcommand -a <cmd> -d '<one-line description>'
complete -c pa -n '__fish_seen_subcommand_from <cmd>' -l <flag>  -d '<description>' -r
complete -c pa -n '__fish_seen_subcommand_from <cmd>' -l <enum-flag> -d '<description>' -r -a '<val1> <val2> <val3>'
```

## Template: Adding a Nested Subcommand

```fish
# --- <cmd>: nested subcommands ---
complete -c pa -n __fish_use_subcommand -a <cmd> -d '<description>'
complete -c pa -n '__fish_seen_subcommand_from <cmd>; and not __fish_seen_subcommand_from sub1 sub2' -a 'sub1 sub2'

# <cmd> sub1
complete -c pa -n '__fish_seen_subcommand_from <cmd>; and __fish_seen_subcommand_from sub1' -l flag1 -d '<desc>' -r
```

## Template: Adding a Dynamic Helper

```fish
function __pa_<resource>
    # One-line description of what this returns.
    pa <resource> list 2>/dev/null | awk 'NR>2 && NF>0 {
        id = $1;
        title = "";
        for (i=2; i<=NF; i++) title = title (i>2?" ":"") $i;
        print id "\t" title
    }'
end
```

Key rules for dynamic helpers:
- Always redirect stderr: `2>/dev/null`
- Return nothing (not an error) when the CLI is unavailable
- Keep the function fast — parse local files or use `pa` CLI with minimal output
- Use `\t` to separate the completion value from its description

---

## Enum Reference

| Flag | Valid values |
|------|-------------|
| `--type` (ticket create) | `feature` `bug` `task` `review-request` `work-report` `fyi` `idea` `question` |
| `--status` (ticket update/list) | `idea` `requirement-review` `pending-approval` `pending-implementation` `implementing` `review-uat` `done` `rejected` `cancelled` |
| `--priority` | `critical` `high` `medium` `low` |
| `--estimate` | `XS` `S` `M` `L` `XL` |
| `--mode` (deploy) | dynamic via `__pa_modes` |
| `--team-model` / `--agent-model` | `haiku` `sonnet` `opus` |
