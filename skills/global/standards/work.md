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

---

## 3. Spawning Sub-Agents

When any agent spawns a sub-agent (via Agent tool), you MUST pass identity context in the prompt:

```
You are agent "<sub-agent-name>" on team "<team_name>" (deployment: <deployment_id>).
Your parent is: <your-agent-name>.
Your workspace: ~/Documents/ai-usage/deployments/<deployment_id>/<your-agent-name>/<sub-agent-name>/
You follow the global standards from skills/global/standards.md.

Your task: <task description>
```

**Required fields to pass:**
- `deployment_id`
- `team_name`
- `parent` (your own agent name)
- `workspace` path for the sub-agent
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

### Work Report Submission

After logging your session, **every team manager** MUST also submit a brief work report to the review queue for Sinh:

```bash
mkdir -p ~/Documents/ai-usage/sinh-inputs/inbox
```

Write a summary file: `~/Documents/ai-usage/sinh-inputs/inbox/YYYY-MM-DD-<team_name>-<descriptive-topic>.md`

**File naming:** Use a descriptive topic, not just team + deploy ID. Examples:
- `2026-03-12-maintenance-health-check.md`
- `2026-03-12-requirements-pa-review-dashboard.md`
- `2026-03-12-builder-ts-migration-phase-2.md`

```markdown
# Work Report: <descriptive title>

> **Date:** YYYY-MM-DD
> **From:** <team_name> / <agent_name>          ← Reporting team
> **To:** sinh                                   ← Work reports always go to Sinh (do not change)
> **Deployment:** <deploy_id>
> **Type:** work-report
> **Status:** success | partial | failed

## What Was Done
- <bullet summary of work completed>

## Outputs
- <file paths to key outputs>

## Needs Attention
- <anything requiring Sinh's review or decision>
- <or "None">

## Suggested Next Steps
- <what should happen next — which agent/team, or action for Sinh>
```

This report is how Sinh stays informed. Place it in `~/Documents/ai-usage/sinh-inputs/inbox/` (the standardized inbox, not `for-sinh-review/`).

### Delivering Key Deliverables to Sinh

When your work produces a **deliverable** with lasting value (requirements doc, migration plan, analysis report, implementation result) — not just a routine work report — you MUST do three things:

#### 1. Preserve in team artifacts

Copy the deliverable from the ephemeral deployment workspace to your team's persistent `artifacts/` folder:
```bash
cp ~/Documents/ai-usage/deployments/<deploy_id>/<agent_name>/<output>.md \
   ~/Documents/ai-usage/agent-teams/<team_name>/artifacts/YYYY-MM-DD-<descriptive-name>.md
```

#### 2. Send a review request to Sinh's inbox

Create a file in `~/Documents/ai-usage/sinh-inputs/inbox/YYYY-MM-DD-review-<descriptive-topic>.md`.

The review request **embeds the full deliverable content inline** — Sinh should be able to review everything by reading this one file, without navigating to other paths.

```markdown
# Review Request: <descriptive title>

> **Date:** YYYY-MM-DD
> **From:** <team_name> / <agent_name>          ← Sender. Router uses this to notify you of the decision.
> **To:** <target_team_name>                     ← Recipient after approval/rejection. Router uses this to forward the document.
> **Deployment:** <deploy_id>
> **Type:** review-request

## What Was Done
- <bullet summary of what was accomplished>

## What Sinh Needs To Do
- [ ] <specific action — e.g., "Review requirements doc and approve or request changes">
- [ ] <specific decision — e.g., "Decide: web app vs TUI?">
- [ ] <specific feedback — e.g., "Flag any missing requirements">

## Suggested Next Steps
- If approved: <what happens next — e.g., "Route to builder inbox for implementation">
- If changes needed: <how to iterate — e.g., "Re-run with --interactive to refine">

## Also Saved At
- **Artifacts:** ~/Documents/ai-usage/agent-teams/<team_name>/artifacts/<filename>
- **Deployment:** ~/Documents/ai-usage/deployments/<deploy_id>/<agent_name>/

---

## Full Deliverable

<paste the ENTIRE deliverable content here — requirements doc, plan, report, etc.>
<Sinh reads everything in this one file — no need to navigate elsewhere>
```

#### 3. Track in waiting-for-response

Place a tracking copy in your team's `waiting-for-response/`:
```bash
~/Documents/ai-usage/agent-teams/<team_name>/waiting-for-response/YYYY-MM-DD-review-<topic>.md
```

**Use this flow for:** requirements docs, implementation plans, analysis reports, any output needing human review.
**Do NOT use for:** routine health checks, daily summaries, session logs — use the standard work report above for those.

### Plan Draft Template

For daily/weekly plans emitted by the daily team:

```markdown
# Daily Plan — YYYY-MM-DD

> **Type:** plan-draft
> **Generated:** YYYY-MM-DD HH:MM
> **By:** <agent>

<plan content — goals, time budget, avo tasks>
```

### FYI Template

For informational notifications requiring no action from Sinh:

```markdown
# FYI: <descriptive title>

> **Date:** YYYY-MM-DD
> **From:** <team_name> / <agent_name>          ← Sender
> **To:** <recipient_team_name>                  ← Who this is for (e.g., sinh, builder, secretary)
> **Type:** fyi

<brief informational content — what happened, why Sinh might want to know>
```

### Team-to-Team Message Template

For messages between agent teams (routing notifications, decision notifications, coordination):

```markdown
# <Title>

> **Date:** YYYY-MM-DD
> **From:** <team_name> / <agent_name>          ← Who is sending
> **To:** <recipient_team_name>                  ← Team inbox this is placed in
> **Type:** fyi | routing-notification | decision-notification

<content>
```

Both `From:` and `To:` are mandatory. Reference coordinate.md for secretary routing patterns.

### Agent Self-Validation (mandatory before saving review-request or FYI)

Before writing any review-request or FYI to an inbox, verify:
1. `From:` is populated with your `<team_name> / <agent_name>`
2. `To:` is populated with the intended recipient team or `sinh`

**Missing either field = write error, not downstream concern.** Do not save a document without both fields — the router cannot notify you or forward the document if they are missing.

### On failure

Still log. Document what failed, what error occurred, and what was attempted. A failed session log is more valuable than no log.

---

## 7. Communication

- **Agents → Team manager:** Report results via SendMessage or task completion
- **Agents → Agents:** Only if the team objective requires coordination
- **Team manager → User:** Final summary on completion
- Always include your `agent_name` and `team_name` when communicating

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
