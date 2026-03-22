# Agent Standards — Housekeeping (included for housekeeping mode only)

---

## 8. Agent Workspace

Agents have two workspace types:

### 8a. Persistent Team Workspace (agent-teams/)

Every team has a **persistent workspace** that survives across deployments:

```
~/Documents/ai-usage/agent-teams/<team_name>/
```

Use this for:
- Ongoing state that must persist between runs (queues, indexes, accumulated data)
- Cross-deployment context (e.g., what was done last run)
- Team artifacts and deliverables

**On startup**, check your persistent workspace for files from previous runs.

### 8b. Per-Deployment Workspace (deployments/)

Each deployment also gets an ephemeral workspace for run-specific outputs:

```
~/Documents/ai-usage/deployments/<deployment_id>/<agent_name>/
```

### Structure

```
~/Documents/ai-usage/agent-teams/daily/       # Persistent team workspace
│   └── ...                                    # Cross-deployment state

~/Documents/ai-usage/deployments/d-a3f7b2/    # Per-deployment workspace
├── session-gatherer/        # Each agent gets their own directory
│   ├── report.md            # Agent's main output/report
│   └── ...                  # Any intermediate files
├── jsonl-analyst/
│   └── report.md
├── synthesizer/
│   └── report.md
└── team-manager/            # Team manager's own workspace
    └── report.md
```

### Rules

- **On startup**, every agent creates both workspaces:
  - `mkdir -p ~/Documents/ai-usage/agent-teams/<team_name>/`
  - `mkdir -p ~/Documents/ai-usage/deployments/<deployment_id>/<agent_name>/`
- **Per-deployment outputs** (reports, data, intermediate results) go in `deployments/<deployment_id>/<agent_name>/`
- **Persistent state** (cross-run data, queues, indexes) goes in `agent-teams/<team_name>/`
- **Report back to team manager** with workspace path so the manager knows where to find outputs
- **Team manager reviews** agent workspaces after agents report completion — read their files before synthesizing
- **The deployment workspace path** is provided in `<deployment-context>` as `workspace_base` — append your agent name to get your directory
- **Sub-agents** use their parent's workspace with a subdirectory: `<parent-workspace>/<sub-agent-name>/`

### What goes in the workspace

| File type | Example | Required? |
|-----------|---------|-----------|
| Main report/output | `report.md` | Yes — every agent produces at least one output |
| Raw data | `raw-avo-output.txt` | Optional — useful for debugging |
| Intermediate results | `parsed-sessions.json` | Optional — only if useful for review |
| Error logs | `errors.txt` | If errors occurred |

### Team manager's role

After an agent reports completion:
1. Read the agent's workspace files (especially `report.md`)
2. Use the data for synthesis or final output
3. Note any issues in their own session log

---

## 10. Ticket Housekeeping

Agents in housekeeping mode check the ticket system for their team's health rather than scanning inbox folders.

### On startup (MANDATORY for housekeeping mode)

**1. Create workspaces**

```bash
mkdir -p ~/Documents/ai-usage/agent-teams/<team_name>/artifacts
mkdir -p ~/Documents/ai-usage/deployments/<deployment_id>/<agent_name>/
```

**2. Check in-progress tickets (stale check)**

```bash
pa ticket list --assignee <team-name> --status implementing
```

For each ticket in `implementing` state that has not been updated in >3 days, add a stale comment:

```bash
pa ticket comment <ticket-id> --content "Stale check: this ticket has been in 'implementing' for >3 days with no updates. Is work still active?"
```

**3. Check pending review tickets**

```bash
pa ticket list --assignee sinh --type review-request --status review-uat
```

For each review ticket >3 days old, create a reminder FYI:

```bash
pa ticket create \
  --project personal-assistant \
  --title "FYI: Pending review >3 days — <ticket-id>" \
  --type fyi \
  --assignee sinh \
  --priority normal \
  --estimate XS \
  --summary "Ticket <ticket-id> has been waiting for Sinh's review for >3 days: <ticket-title>"
```

**4. Check pending-implementation backlog for your team**

```bash
pa ticket list --assignee <team-name> --status pending-implementation
```

Note awareness of pending work. Then run the board cleanup checks below.

**4a. Board Cleanup (see `workflow-policy.md` §7 for full rules)**

For each `pending-implementation` ticket:

- **Inbox-sweep artifacts** (tagged `inbox-sweep`): check if already done or has a duplicate → cancel with cross-ref comment (§7a)
- **Misrouted tickets**: verify `--project` matches the repo via `pa repos list` → recreate in correct project + cancel original (§7b)
- **Missing `doc_ref`**: if summary is too thin to execute → add `backlog` tag with comment (§7c)

**5. Check for active bulletins**

```bash
pa bulletin list
```

Note any active bulletins in the housekeeping report, especially if they affect this team's operations.

**6. Begin main housekeeping work**

### Ongoing ticket claim/release protocol

When picking up a ticket for multi-step work:

```
Ticket in 'pending-implementation' state
  ↓
Agent claims it
  → pa ticket update <id> --status implementing --assignee <agent>
  → begin work

Agent work completes
  → pa ticket update <id> --status review-uat --assignee sinh
  → add completion comment on the ticket

Agent work fails / aborts
  → keep current status; add blocked tag: pa ticket update <id> --tags blocked
  → pa ticket comment <id> --content "BLOCKED: <reason>. Waiting on: <dependency>"
  → create FYI ticket for Sinh explaining the failure
```

**Rules:**
- Always claim (set to `implementing`) before starting work — never work on a `pending-implementation` ticket without claiming
- Never leave a ticket in `implementing` state without a comment when you stop — add a comment if interrupted
- Short single-step work that completes in one action: `pending-implementation → review-uat --assignee sinh` directly, no `implementing` step needed
- `blocked` is a tag, not a status — use `--tags blocked` + comment protocol instead

### When a task cannot be completed

- Keep the ticket's current status — do NOT change it to `blocked`
- Add `blocked` tag: `pa ticket update <id> --tags blocked`
- Add a comment explaining what's blocking it: `pa ticket comment <id> --content "BLOCKED: <reason>. Waiting on: <dependency or decision>"`
- Create a separate task ticket for whoever can unblock you
- When unblocked: remove `blocked` tag, add a comment noting what resolved the block

---

## 11. Routing Fields (ticket-based)

All cross-team documents now use ticket fields instead of inline `From:` / `To:` metadata.

| Old field | New equivalent |
|-----------|---------------|
| `From: <team> / <agent>` | `--summary` includes agent identity; ticket audit log records actor |
| `To: <team>` | `--assignee <recipient-team>` on the ticket |
| `Type: work-report` | `--type work-report` |
| `Type: review-request` | `--type review-request` |
| `Type: fyi` | `--type fyi` |

**Self-validation (mandatory):** Before creating any ticket, verify `--assignee` and `--title` are populated and meaningful. A ticket without a clear recipient assignee is unroutable.

---

## Quick Reference

```
Identity:       deployment_id + team_name + agent_name + parent + ticket_id
Registry:       ~/Documents/ai-usage/deployments/registry.jsonl (team manager only, flock)
Team workspace: ~/Documents/ai-usage/agent-teams/<team-name>/  (persistent, cross-deployment)
Run workspace:  ~/Documents/ai-usage/deployments/<deploy-id>/<agent-name>/  (per-deployment)
Bulletins:      pa bulletin list  (check on startup — FIRST priority!)
Ticket work:    pa ticket list --assignee <team> --status pending-implementation
Ticket claim:   pa ticket update <id> --status implementing --assignee <agent>
Ticket done:    pa ticket update <id> --status review-uat --assignee sinh
Blocked:        pa ticket update <id> --tags blocked  (keep status, add tag + comment)
Review request: pa ticket create --type review-request --assignee <downstream> --estimate M
FYI:            pa ticket create --type fyi --assignee <recipient> --estimate XS
Session logs:   ~/Documents/ai-usage/sessions/YYYY/MM/agent-team/
File naming:    YYYY-MM-DD-<hash>-<team>--<agent>--<TICKET-ID>--<topic>.md
Tags:           autonomous team:<X> agent:<Y> deployment:<Z>
Startup HK:     1) create workspaces  2) stale implementing-tickets check  3) pending review-uat check  4) pending-implementation backlog awareness  4a) board cleanup (inbox-sweep/misrouted/no-doc_ref — see workflow-policy §7)  5) bulletin check  6) main work
Shutdown:       sub-agents → agents → manager (each logs before stopping)
```
