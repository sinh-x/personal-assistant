# Agent Standards — Work (included for work and interactive modes)

---

## 2. Registry & Completion

The deployment registry tracks all team deployments:
- **File:** `~/Documents/ai-usage/deployments/registry.jsonl`
- **Lock:** `~/Documents/ai-usage/deployments/.registry.lock`

### Who writes to the registry

| Event | Who writes it | When |
|-------|--------------|------|
| `started` | `deploy.sh` (automatic) | Before claude launches |
| `pid` | `deploy.sh` (automatic) | After background launch |
| `completed` | **Team manager** (you) | After all work + logging done |
| `crashed` | `deploy.sh` shell wrapper | If claude exits non-zero |

### Completion marker (team manager only)

After all agents finish and all session logs are written, the team manager writes:

```bash
flock -w 5 ~/Documents/ai-usage/deployments/.registry.lock bash -c "echo '{\"deployment_id\":\"<DEPLOYMENT_ID>\",\"team\":\"<TEAM_NAME>\",\"event\":\"completed\",\"timestamp\":\"'$(date -Iseconds)'\",\"status\":\"<success|partial|failed>\",\"summary\":\"<one-line summary>\"}' >> ~/Documents/ai-usage/deployments/registry.jsonl"
```

**Status values:**
- `success` — all tasks completed without errors
- `partial` — some tasks completed, some failed or skipped
- `failed` — critical failure, objective not met

**Individual agents do NOT write to the registry.** Only the team manager writes the completion marker.

### Ticket Work Tracking

In addition to the deployment registry, all work items are tracked as tickets.

**On startup — check for assigned work:**

```bash
pa ticket list --team <team-name> --status todo
pa ticket list --team <team-name> --status doing
```

**Claim a ticket before starting:**

```bash
pa ticket update <ticket-id> --status doing --assignee <agent-name>
```

**On completion — update ticket status:**

```bash
pa ticket update <ticket-id> --status done
```

---

## 3. Spawning Sub-Agents

When any agent spawns a sub-agent (via Agent tool), you MUST pass identity context in the prompt:

```
You are agent "<sub-agent-name>" on team "<team_name>" (deployment: <deployment_id>).
Your parent is: <your-agent-name>.
Your workspace: ~/Documents/ai-usage/deployments/<deployment_id>/<your-agent-name>/<sub-agent-name>/
You follow the global standards from skills/global/standards.md.

Current ticket: <ticket-id> (or "none" if no assigned ticket for this deployment)

Your task: <task description>
```

**Required fields to pass:**
- `deployment_id`
- `team_name`
- `parent` (your own agent name)
- `workspace` path for the sub-agent
- `ticket_id` — the current ticket being worked on (if any)
- A clear name for the sub-agent

**Sub-agents inherit all global standards.** Remind them of the key ones:
- Log their work (session logging)
- Use real identity in logs
- Report results back to parent

---

## 4. Session Logging

Every agent (including team manager and sub-agents) MUST log their session.

### Storage

```
~/Documents/ai-usage/sessions/YYYY/MM/agent-team/
```

Agent sessions go in the `agent-team/` subfolder. Never write to the month root (that's for human sessions).

### File naming

```
YYYY-MM-DD-<6char-hash>-<team_name>--<agent_name>--<2-word-topic>.md
```

### Session content (strict format)

```markdown
# AI Session Log

> **Session ID:** <6-char hash>
> **Date:** YYYY-MM-DD
> **Time:** HH:MM (24h)
> **Deployment:** <deployment_id>
> **Agent:** <agent_name>
> **Team:** <team_name>
> **Parent:** <parent agent name>
> **Role:** <role description>
> **Type:** Autonomous deployment
> **Tier:** 1

## Timeline
- HH:MM — Started: <objective>
- HH:MM — <milestone>
- HH:MM — Completed / Failed

## What Happened
<2-5 bullet points>

## Results
- **Status:** Success / Partial / Failed
- **Workspace:** ~/Documents/ai-usage/deployments/<deployment_id>/<agent_name>/
- **Outputs:** <files in workspace>
- **Errors:** <errors or "None">

## What I Learned
- <insight>

## Self-Improvement
Reflect honestly on your own performance this session.

### What could be improved?
- <something in the skill, workflow, or tools that was inefficient, unclear, or broken>

### Why?
- <root cause — why did this happen? what's the gap?>

### How to fix it?
- <concrete, actionable suggestion — e.g., "add retry logic to file-upload step", "split Phase 3 into two steps", "add validation before Anytype save">

### Scope
- `skill` / `team` / `infra` / `prompt` — what category does this improvement belong to?

## Follow-up Tasks
- [ ] <if any>

## Tags
`autonomous` `team:<team_name>` `agent:<agent_name>` `deployment:<deployment_id>` `<domain-tags>`
```

### How to save

```bash
mkdir -p ~/Documents/ai-usage/sessions/$(date +%Y)/$(date +%m)/agent-team
hash=$(head -c 3 /dev/urandom | xxd -p)
filename="$(date +%Y-%m-%d)-${hash}-<team_name>--<agent_name>--<topic>.md"
```

Write the file using bash heredoc or Write tool.

### Optionally also save via MCP (for stats indexing)

```
ToolSearch("select:mcp__ai-usage-log__prepare_session")
mcp__ai-usage-log__prepare_session(cwd=<working_directory>)

ToolSearch("select:mcp__ai-usage-log__save_session_bundle")
mcp__ai-usage-log__save_session_bundle(
  content=<session markdown>,
  cwd=<working_directory>,
  brief="<team_name>--<agent_name>--<topic>"
)
```

### When to log

| Role | When |
|------|------|
| Sub-agent | Before returning results to parent |
| Agent | After all tasks done, before shutdown |
| Team manager | After all agents done + completion marker, last thing before exit |

### Work Report (centralized, file-based)

After logging your session, **every team manager** MUST write a work-report file to the centralized inbox:

```
~/Documents/ai-usage/sinh-inputs/inbox/YYYY-MM-DD-<team_name>-<descriptive-topic>.md
```

**Do NOT create a ticket for routine work reports.** Work reports are centralized files — sprint-master aggregates them. Only create tickets for items that require action (review-request, fyi, or blocked notifications).

**Work report file format:**

```markdown
# Work Report: <descriptive-topic>

> **Date:** YYYY-MM-DD
> **From:** <team_name> / team-manager
> **To:** sinh
> **Deployment:** <deployment_id>
> **Type:** work-report
> **Status:** success | partial | failed

## What Was Done
- <bullet points>

## Results
- <outputs, files, ticket IDs>

## Needs Attention
- <items requiring Sinh input, or "None">

## Suggested Next Steps
- <follow-up actions>
```

**Descriptive topic examples:**
- `builder-global-standards-migration`
- `maintenance-health-check`
- `requirements-pa-review-dashboard`

### Delivering Key Deliverables (Review Requests)

When your work produces a **deliverable** with lasting value (requirements doc, migration plan, analysis report) — not just a routine work report:

**Step 1 — Save deliverable to team artifacts:**

```bash
cp ~/Documents/ai-usage/deployments/<deploy_id>/<agent_name>/<output>.md \
   ~/Documents/ai-usage/agent-teams/<team_name>/artifacts/YYYY-MM-DD-<descriptive-name>.md
```

**Step 2 — Create a review-request ticket:**

```bash
pa ticket create \
  --project personal-assistant \
  --title "Review: <descriptive-topic>" \
  --type review-request \
  --team <downstream-team-if-approved> \
  --priority high \
  --estimate M \
  --doc-ref "agent-teams/<team_name>/artifacts/YYYY-MM-DD-<descriptive-name>.md" \
  --summary "<what was built; what Sinh needs to review; what happens if approved>"
```

The `--team` field is the downstream team that receives the work if Sinh approves. Sinh updates ticket status to route it.

The `--doc-ref` points to the full deliverable in `artifacts/`. Sinh reads the ticket summary first, then opens the artifact for details.

**Use this flow for:** requirements docs, implementation plans, analysis reports, any output needing human review.
**Do NOT use for:** routine session logs — use work-report ticket above for those.

### FYI (informational notification)

For non-actionable information that Sinh or another team should know:

```bash
pa ticket create \
  --project personal-assistant \
  --title "FYI: <descriptive-topic>" \
  --type fyi \
  --team <recipient-team-or-sinh> \
  --priority low \
  --estimate XS \
  --summary "<brief informational content — what happened, why it is relevant>"
```

### Plan Draft

For daily/weekly plans emitted by the daily team:

```bash
pa ticket create \
  --project personal-assistant \
  --title "Daily Plan: YYYY-MM-DD" \
  --type plan-draft \
  --team sinh \
  --priority normal \
  --estimate XS \
  --doc-ref "daily/YYYY/MM/YYYY-MM-DD-plan.md" \
  --summary "<goals and time budget summary>"
```

### On failure

Still log. Document what failed, what error occurred, and what was attempted. A failed session log is more valuable than no log.

---

## 5. Ticket Workflow

Agents interact with work exclusively through the ticket system — not inbox files.

### Check for assigned work on startup

```bash
# High-priority work first
pa ticket list --team <team-name> --status todo --priority high

# All todo work
pa ticket list --team <team-name> --status todo

# Resume any in-progress work
pa ticket list --team <team-name> --status doing
```

### Claim a ticket

```bash
pa ticket update <ticket-id> --status doing --assignee <agent-name>
```

### Update as you work

```bash
# When blocked
pa ticket update <ticket-id> --status blocked
pa ticket comment <ticket-id> --content "Blocked by: <reason>"

# When sending for review
pa ticket update <ticket-id> --status review

# When complete
pa ticket update <ticket-id> --status done
```

### Create tickets for discovered work

When you identify follow-up work or issues during your task:

```bash
pa ticket create \
  --project personal-assistant \
  --title "<title>" \
  --type task \
  --team <team> \
  --priority normal \
  --estimate <XS|S|M|L|XL> \
  --summary "<description of the work needed>"
```

---

## 6. Bulletin Awareness

Before starting your main objective, check for active bulletins:

```bash
pa bulletin list
```

Active bulletins are also injected into your primer under `## Active Bulletins` — read that section on startup.

If a bulletin blocks your team (`block: all` or your team name in `block:`) and you are NOT listed in `except:`:
1. **Do not proceed with the main objective**
2. Write a work-report file noting the block:
   ```
   ~/Documents/ai-usage/sinh-inputs/inbox/YYYY-MM-DD-<team_name>-deployment-blocked.md
   ```
   Content: deployment ID, bulletin title, reason blocked, no work performed.
3. Write the completion marker (failed status) and exit.

---

## 7. Communication

- **Agents → Team manager:** Report results via SendMessage or task completion
- **Agents → Agents:** Only if the team objective requires direct coordination
- **Team manager → Sinh (routine):** Write work-report file to `sinh-inputs/inbox/` — NOT a ticket
- **Team manager → Sinh (deliverable):** Create review-request ticket pointing to artifact in `agent-teams/<team>/artifacts/`
- **All cross-team communication:** Via tickets (FYI, review-request types) — not inbox files; work-reports are files not tickets
- Always include your `agent_name` and `team_name` in ticket titles, summaries, and comments

---

## 9. Self-Improvement

Every agent MUST reflect on its own performance in the `## Self-Improvement` section of their session log (see §4 template).

Be specific and honest — generic notes like "could be faster" are useless.

Good example:
- **What:** Anytype file-upload failed with PERMISSION_DENIED
- **Why:** gRPC auth requires Anytype desktop app running, but agent runs headless
- **How:** Add a pre-check step that tests gRPC connectivity before attempting uploads
- **Scope:** `skill`

### Scope categories

| Scope | Meaning | Who fixes it |
|-------|---------|-------------|
| `skill` | The agent's skill markdown needs updating | Edit `skills/<skill>.md` |
| `team` | The team YAML or coordination needs changing | Edit `teams/<team>.yaml` |
| `infra` | deploy.sh, status.sh, or framework scripts | Edit scripts |
| `prompt` | The primer or objective wording needs tuning | Edit deploy.sh or daily.sh |

These suggestions are aggregated by the daily-end summary team into the daily report for review and action.
