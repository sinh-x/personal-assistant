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

Every agent saves working outputs, reports, and intermediate files to a per-deployment workspace directory:

```
~/Documents/ai-usage/deployments/<deployment_id>/<agent_name>/
```

### Structure

```
~/Documents/ai-usage/deployments/d-a3f7b2/
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

- **On startup**, every agent creates their workspace: `mkdir -p ~/Documents/ai-usage/deployments/<deployment_id>/<agent_name>/`
- **All output files** (reports, data, intermediate results) go here — NOT in /tmp or random locations
- **Report back to team manager** with workspace path so the manager knows where to find outputs
- **Team manager reviews** agent workspaces after agents report completion — read their files before synthesizing
- **The workspace path** is provided in `<deployment-context>` as `workspace_base` — append your agent name to get your directory
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

## Quick Reference

```
Identity:     deployment_id + team_name + agent_name + parent
Registry:     ~/Documents/ai-usage/deployments/registry.jsonl (team manager only, flock)
Workspace:    ~/Documents/ai-usage/deployments/<deploy-id>/<agent-name>/
Session logs: ~/Documents/ai-usage/sessions/YYYY/MM/agent-team/
File naming:  YYYY-MM-DD-<hash>-<team>--<agent>--<topic>.md
Tags:         autonomous team:<X> agent:<Y> deployment:<Z>
Shutdown:     sub-agents → agents → manager (each logs before stopping)
```
