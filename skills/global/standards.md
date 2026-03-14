# Agent Standards (Global — mandatory for ALL agents)

These are the non-negotiable standards every agent, team manager, and sub-agent must follow. They apply regardless of your team or purpose.

---

## 1. Identity

Every agent has an identity from the `<deployment-context>` block. You MUST know and use:

| Field | Where it comes from |
|-------|--------------------|
| **deployment_id** | `<deployment-context>` or passed by parent agent |
| **team_name** | `<deployment-context>` or passed by parent agent |
| **agent_name** | Your name (from team YAML), or `team-manager` if you are the manager |
| **parent** | Who spawned you — `deploy.sh` for team-manager, `team-manager` for agents, agent name for sub-agents |
| **role** | Your role description from the team definition |

**Rules:**
- Never use generic names like "agent", "assistant", or "Claude"
- Always identify yourself by agent_name + team_name in logs and messages
- Pass your full identity chain when spawning sub-agents (see §3)

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
> **From:** <team_name> / <agent_name>
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
> **From:** <team_name> / <agent_name>
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
> **From:** <team_name> / <agent_name>
> **Type:** fyi

<brief informational content — what happened, why Sinh might want to know>
```

### On failure

Still log. Document what failed, what error occurred, and what was attempted. A failed session log is more valuable than no log.

---

## 5. Error Handling

- **Never silently swallow errors.** Log them in your session and report to parent/manager.
- **On tool failure:** Try once, if it fails again report the error and move on. Do not retry in a loop.
- **On permission errors:** Log the error, skip that step, note it in Results.
- **On critical failure:** Log your session, send error report to parent, stop.

---

## 6. Shutdown Protocol

Agents shut down in this order:

1. **Sub-agents** finish and log → return results to parent agent
2. **Agents** finish all tasks and log → report completion to team manager
3. **Team manager** collects all results → writes own session log → writes registry completion marker → shuts down team → exits

**Never shut down without logging.** If you're told to shut down, log first.

---

## 7. Communication

- **Agents → Team manager:** Report results via SendMessage or task completion
- **Agents → Agents:** Only if the team objective requires coordination
- **Team manager → User:** Final summary on completion
- Always include your `agent_name` and `team_name` when communicating

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
- Files other teams or the secretary need to find reliably

**On startup**, check your persistent workspace for files from previous runs or items routed by the secretary agent.

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
- **Check for outstanding docs on startup**: Scan your persistent workspace (`agent-teams/<team_name>/`) for files left by previous runs or the secretary agent (e.g., routed items, pending reviews, follow-up tasks). Incorporate any relevant outstanding docs into your current run.
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

## 9. Self-Improvement

Every agent MUST reflect on its own performance in the `## Self-Improvement` section of their session log (see §4 template). (Previously §8, renumbered.)

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

---

## 10. Inbox Communication Workflow

Every team has standardized workflow folders in their persistent workspace. All agents MUST use these for cross-team and agent-to-Sinh communication.

### Folder structure (every team + Sinh)

```
~/Documents/ai-usage/agent-teams/<team_name>/
├── inbox/                  # Items arriving for you to process
├── waiting-for-response/   # Items you sent out, awaiting reply
├── done/                   # Completed items
├── archives/               # Older completed items (periodic cleanup)
└── artifacts/              # Reference materials, context docs

~/Documents/ai-usage/sinh-inputs/
├── inbox/                  # Items FROM agents TO Sinh
├── waiting-for-response/   # Items Sinh sent TO agents, awaiting reply
├── done/                   # Items Sinh has handled
├── archives/               # Archived items
└── artifacts/              # Sinh's reference materials
```

### On startup (MANDATORY)

Before starting your main work, every agent MUST run this startup sequence in order:

**1. Create workspaces** (team + per-deployment)
```bash
mkdir -p ~/Documents/ai-usage/agent-teams/<team_name>/
mkdir -p ~/Documents/ai-usage/deployments/<deployment_id>/<agent_name>/
```

**2. Check your team's `inbox/`** for pending items from other agents or the secretary

**3. WFR self-resolution check** — scan your `waiting-for-response/` against Sinh's outcome folders:

For each file in `~/Documents/ai-usage/agent-teams/<team_name>/waiting-for-response/`:
- a. Extract topic slug: strip date prefix from filename (`YYYY-MM-DD-<topic>.md` → `<topic>`)
- b. Scan `~/Documents/ai-usage/sinh-inputs/approved/`, `rejected/`, `deferred/` for a filename containing the same topic slug
- c. **If match found:** append an outcome note to the WFR file, then move it to `done/`:
  ```
  Closed — Approved/Rejected/Deferred by Sinh on YYYY-MM-DD
  ```
- d. **If no match AND item is >3 days old:** create a reminder in `~/Documents/ai-usage/sinh-inputs/inbox/` (check first — skip if a reminder for this topic already exists there):
  ```markdown
  # Reminder: Still waiting — <topic>

  > **Date:** YYYY-MM-DD
  > **From:** <team_name> / <agent_name>
  > **Type:** reminder

  Item has been waiting for response for >3 days.

  - **Original item:** <filename>
  - **Waiting since:** <item date>
  - **Days waiting:** N
  - **Suggested action:** Review and move to approved/, rejected/, or deferred/
  ```

**4. Incorporate outstanding active inbox items** into your current run — don't ignore them

**5. Begin main work**

### WFR Matching Rules

- **Match strategy:** Compare topic slug (filename without date prefix) between WFR item and files in `approved/`, `rejected/`, `deferred/`
  - Example: WFR `2026-03-13-review-pa-agent-model-selection.md` → topic `review-pa-agent-model-selection`
  - Approved: `2026-03-13-review-pa-agent-model-selection.md` → match ✓
- **Idempotent:** Never duplicate reminders. Before creating a reminder, check `sinh-inputs/inbox/` for an existing file with the same topic slug.
- **Do NOT re-process** WFR items already in `done/` or `archives/`.

### When you need a review or response from another agent or Sinh

1. Create a markdown file: `YYYY-MM-DD-<topic>.md`
2. Place it in the **recipient's** `inbox/`:
   - Agent team: `~/Documents/ai-usage/agent-teams/<recipient-team>/inbox/`
   - Sinh: `~/Documents/ai-usage/sinh-inputs/inbox/`
3. Place a tracking copy in **your team's** `waiting-for-response/`:
   - `~/Documents/ai-usage/agent-teams/<your-team>/waiting-for-response/`
   - The tracking copy should reference the original and what you're waiting for

### When you pick up an inbox item

1. Process the item
2. Move processed item to your team's `done/`
3. If you need to respond, place the response in the **sender's** `inbox/`
4. Note in your response which `waiting-for-response/` item it resolves

### When a task cannot be completed

- If blocked by a dependency or waiting for external input, move the item to `waiting-for-response/` (not `done/`)
- Document what's blocking it inside the file
- Create a corresponding inbox item for whoever can unblock you

### Completed tasks

- Move to `done/` when finished
- The secretary periodically moves old `done/` items (>7 days) to `archives/`

### File naming

All inbox/workflow files use: `YYYY-MM-DD-<topic>.md` (kebab-case)

### Rules

- **Never delete workflow files.** Move to `done/` or `archives/`, never remove.
- **Idempotent.** Don't re-process items already in `done/` or `archives/`.
- **Preserve context.** When moving items, keep original filename.

---

## Quick Reference

```
Identity:       deployment_id + team_name + agent_name + parent
Registry:       ~/Documents/ai-usage/deployments/registry.jsonl (team manager only, flock)
Team workspace: ~/Documents/ai-usage/agent-teams/<team-name>/  (persistent, cross-deployment)
Run workspace:  ~/Documents/ai-usage/deployments/<deploy-id>/<agent-name>/  (per-deployment)
Team inbox:     ~/Documents/ai-usage/agent-teams/<team-name>/inbox/  (check on startup!)
Sinh inbox:     ~/Documents/ai-usage/sinh-inputs/inbox/  (items for Sinh)
Session logs:   ~/Documents/ai-usage/sessions/YYYY/MM/agent-team/
File naming:    YYYY-MM-DD-<hash>-<team>--<agent>--<topic>.md
Tags:           autonomous team:<X> agent:<Y> deployment:<Z>
Startup:        1) create workspaces  2) check inbox/  3) WFR self-resolve (approved|rejected|deferred) + 3-day reminder  4) incorporate active items  5) main work
Shutdown:       sub-agents → agents → manager (each logs before stopping)
```
