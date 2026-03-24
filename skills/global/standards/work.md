# Agent Standards — Work (included for work and interactive modes)

---

## 0. Startup Priority Order

Every agent follows this priority order on startup:

1. **Check bulletins first** (see §6). If an active bulletin blocks your team, stop and exit.
2. **Check Additional Instructions** — if your primer has an `## Additional Instructions` section, that is your PRIMARY objective. Execute it and skip the routine ticket scan entirely.
3. **Routine ticket triage** — only if there are no additional instructions:
   - Resume any `implementing` tickets: `pa ticket list --assignee <team> --status implementing`
   - Pick up new assigned work: `pa ticket list --assignee <team> --status pending-implementation`
   - Check high-priority items first: add `--priority high` to each query

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
pa registry complete <DEPLOYMENT_ID> --status <success|partial|failed> --summary "<one-line summary>"
```

**Status values:**
- `success` — all tasks completed without errors
- `partial` — some tasks completed, some failed or skipped
- `failed` — critical failure, objective not met

**Individual agents do NOT write to the registry.** Only the team manager writes the completion marker.

### Ticket Work Tracking

In addition to the deployment registry, all work items are tracked as tickets.

**On startup — check for assigned work (see §0 for priority order):**

```bash
# Resume in-progress tickets first
pa ticket list --assignee <team-name> --status implementing

# Then pick up new assigned work
pa ticket list --assignee <team-name> --status pending-implementation
```

**Claim a ticket before starting:**

Always use team-qualified `<team>/<agent>` format for `--assignee` (e.g., `builder/team-manager`). Bare agent names are deprecated.

```bash
pa ticket update <ticket-id> --status implementing --assignee <team>/<agent-name>
```

**On completion — role-specific status transitions:**

```bash
# Builder / maintenance / house-chores → advance to UAT review
# Always include --doc-ref pointing to implementation artifact (type: implementation)
pa ticket update <ticket-id> --status review-uat --assignee sinh \
  --doc-ref "implementation:agent-teams/<team>/artifacts/YYYY-MM-DD-<topic>.md"

# Requirements team → advance to approval gate
# Always include --doc-ref pointing to requirements document (type: requirements)
pa ticket update <ticket-id> --status pending-approval --assignee sinh \
  --doc-ref "requirements:agent-teams/requirements/artifacts/YYYY-MM-DD-<topic>.md"
```

### Doc-ref requirement on handoff (mandatory)

**Always set `--doc-ref` when advancing to `pending-approval` or `review-uat`.** This ensures downstream teams and Sinh can access the full context — plan document, requirements doc, or implementation artifact — without searching.

If you advance without `--doc-ref` and the ticket has no `doc_refs` already:
- The CLI prints a warning to stderr (transition still succeeds — soft enforcement)
- The `needs-doc-ref` tag is automatically added to the ticket
- Sprint-master monitors `needs-doc-ref` tickets during triage and escalates

Add the document retroactively if you forgot:
```bash
pa ticket update <ticket-id> --doc-ref "[type:]path/to/doc.md"
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

### Workspace Storage Tiers

The ai-usage system has three storage tiers. Use each for the right purpose:

| Tier | Path | Lifetime | Purpose |
|------|------|----------|---------|
| **Ephemeral workspace** | `~/Documents/ai-usage/deployments/<deploy-id>/` | Per-run (cleaned up after deployment) | In-progress scratch space, intermediate files, draft outputs |
| **Persistent artifacts** | `~/Documents/ai-usage/agent-teams/<team>/artifacts/` | Survives across deployments | Final deliverables: requirements docs, implementation plans, analysis reports |
| **Historical logs** | `~/Documents/ai-usage/sessions/YYYY/MM/agent-team/` | Permanent archive | Session logs, timeline, self-improvement notes |

**When to save to each tier:**

- **Ephemeral workspace** (`deployments/<deploy-id>/`) — use during a single deployment for scratch files. Do NOT use for final deliverables — this path is cleaned up after the deployment ends.
- **Persistent artifacts** (`agent-teams/<team>/artifacts/`) — save all final deliverables here **before** attaching via `--doc-ref`. This tier survives across deployments and is accessible to Sinh and downstream teams. Always use this path in `--doc-ref`.
- **Historical logs** (`sessions/YYYY/MM/agent-team/`) — session logs written at the end of every deployment. Do NOT save deliverables or artifacts here.

**Key rule — save then attach:** Save the final deliverable to `agent-teams/<team>/artifacts/YYYY-MM-DD-<topic>.md` FIRST, then attach it to the ticket with `pa ticket update <id> --doc-ref "agent-teams/<team>/artifacts/YYYY-MM-DD-<topic>.md"`. Never use `deployments/` paths in `--doc-ref` — that workspace is ephemeral and will not survive.

---

### Artifact Finalization (REQUIRED before any status handoff)

Before advancing a ticket to `pending-approval` or `review-uat`, complete these steps in order — skipping any step leaves the ticket without accessible context.

**Step 1 — Save deliverable to team artifacts:**
```bash
# Save to the persistent artifacts tier — NOT the ephemeral deployments/ workspace
cp <draft-output> ~/Documents/ai-usage/agent-teams/<team>/artifacts/YYYY-MM-DD-<descriptive-name>.md
```

**Step 2 — Add to the ticket's doc_refs:**
```bash
# Use typed format: requirements:, spike:, implementation:, review-report:, or attachment:
pa ticket update <ticket-id> --doc-ref "[type]:agent-teams/<team>/artifacts/YYYY-MM-DD-<descriptive-name>.md"
```

**Step 3 — Advance the ticket (only after Steps 1 and 2):**
```bash
pa ticket update <ticket-id> --status pending-approval --assignee sinh   # requirements team
# or
pa ticket update <ticket-id> --status review-uat --assignee sinh         # builder team
```

**Why this order matters:** Advancing first and saving later risks leaving the ticket pointing to nothing if the session is interrupted. Always: save → attach → advance.

> If you forgot: run `pa ticket update <id> --doc-ref [type:]<path>` retroactively. The CLI warns and adds the `needs-doc-ref` tag automatically if you skip this step.

---

### Storage (Session Logs)

```
~/Documents/ai-usage/sessions/YYYY/MM/agent-team/
```

Agent sessions go in the `agent-team/` subfolder. Never write to the month root (that's for human sessions).

### File naming

```
YYYY-MM-DD-<6char-hash>-<team_name>--<agent_name>--<TICKET-ID>--<2-word-topic>.md
```

Include the ticket ID when working on a ticket. Omit it (use the original 2-word format) for non-ticket-driven sessions.

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
# With ticket ID (preferred when working on a ticket):
filename="$(date +%Y-%m-%d)-${hash}-<team_name>--<agent_name>--<TICKET-ID>--<topic>.md"
# Without ticket ID (non-ticket-driven work):
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

### Ticket-centric Output Flow

When you complete work on a ticket, output goes in TWO places:

**1. Brief completion comment on the ticket (REQUIRED):**

```bash
pa ticket comment <ticket-id> --author <agent-name> --content "Completed: <1-2 sentence summary>. Session log: sessions/YYYY/MM/agent-team/<session-log-filename.md>"
```

This replaces standalone work-report files. Sprint-master reads these comments for daily digest aggregation.

**2. Full session log file (REQUIRED):**

Save to `sessions/YYYY/MM/agent-team/` with ticket ID in filename. The log preserves full context, timeline, and self-improvement notes (see §4 template and file naming above).

**Artifacts** (deliverables, analysis reports, requirements docs):
- Save to `agent-teams/<team>/artifacts/YYYY-MM-DD-<descriptive-name>.md`
- Link from ticket via `--doc-ref [type:]<path>` (additive — does not overwrite existing doc_refs)

**Do NOT write standalone work-report files to `sinh-inputs/inbox/`.** That protocol is deprecated. All reporting happens through ticket comments and linked artifacts.

### Delivering Key Deliverables (Review Requests)

When your work produces a **deliverable** with lasting value (requirements doc, migration plan, analysis report) — not just a routine completion:

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
  --assignee <downstream-team-if-approved> \
  --priority high \
  --estimate M \
  --doc-ref "[type]:agent-teams/<team_name>/artifacts/YYYY-MM-DD-<descriptive-name>.md" \
  --summary "<what was built; what Sinh needs to review; what happens if approved>"
```

The `--assignee` field is the downstream team that receives the work if Sinh approves. Sinh updates ticket status to route it.

The `--doc-ref` adds an entry to `doc_refs[]` pointing to the full deliverable in `artifacts/`. Sinh reads the ticket summary first, then opens the artifact for details.

**Use this flow for:** requirements docs, implementation plans, analysis reports, any output needing human review.
**Do NOT use for:** routine session completions — add a ticket comment instead (see §Ticket-centric Output Flow).

### FYI (informational notification)

For non-actionable information that Sinh or another team should know:

```bash
pa ticket create \
  --project personal-assistant \
  --title "FYI: <descriptive-topic>" \
  --type fyi \
  --assignee <recipient-team-or-sinh> \
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
  --assignee sinh \
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

Follow §0 priority order. For routine ticket scanning:

```bash
# Resume in-progress work first (high-priority first)
pa ticket list --assignee <team-name> --status implementing --priority high
pa ticket list --assignee <team-name> --status implementing

# Pick up new assigned work
pa ticket list --assignee <team-name> --status pending-implementation --priority high
pa ticket list --assignee <team-name> --status pending-implementation

# Requirements team: check for elaboration work
pa ticket list --assignee requirements --status requirement-review
```

### Claim a ticket

```bash
pa ticket update <ticket-id> --status implementing --assignee <team>/<agent-name>
```

### Update as you work

```bash
# When blocked — keep current status, add blocked TAG + comment
pa ticket update <ticket-id> --tags blocked
pa ticket comment <ticket-id> --content "BLOCKED: <reason>. Waiting on: <dependency or decision>."
# When unblocked: update tags without blocked, add resolution comment

# When implementation complete — builder / maintenance / house-chores → UAT
# Always include --doc-ref (see §Doc-ref requirement on handoff)
pa ticket update <ticket-id> --status review-uat --assignee sinh \
  --doc-ref "implementation:agent-teams/<team>/artifacts/YYYY-MM-DD-<topic>.md"

# When requirements complete — requirements team → approval gate
# Always include --doc-ref (see §Doc-ref requirement on handoff)
pa ticket update <ticket-id> --status pending-approval --assignee sinh \
  --doc-ref "requirements:agent-teams/requirements/artifacts/YYYY-MM-DD-<topic>.md"
```

### Create tickets for discovered work

When you identify follow-up work or issues during your task:

```bash
pa ticket create \
  --project personal-assistant \
  --title "<title>" \
  --type task \
  --assignee <team> \
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
2. Create a FYI ticket noting the block:
   ```bash
   pa ticket create \
     --project personal-assistant \
     --title "FYI: Deployment blocked by bulletin — <bulletin title>" \
     --type fyi \
     --assignee sinh \
     --priority high \
     --estimate XS \
     --summary "Deployment <deployment_id> blocked by active bulletin: <bulletin title>. Team: <team_name>. No work performed."
   ```
3. Write the completion marker (failed status) and exit.

---

## 7. Communication

- **Agents → Team manager:** Report results via SendMessage or task completion
- **Agents → Agents:** Only if the team objective requires direct coordination
- **Team manager → Sinh (routine):** Add completion comment on the working ticket — NOT a separate file or ticket
- **Team manager → Sinh (deliverable):** Create review-request ticket pointing to artifact in `agent-teams/<team>/artifacts/`
- **All cross-team communication:** Via tickets (FYI, review-request types)
- Always include your `agent_name` and `team_name` in ticket titles, summaries, and comments

---

## 8. One Ticket Per Work Item

**Core rule:** Every piece of work has ONE ticket. All lifecycle tracking happens on that ticket via comments and status transitions.

**Do NOT create separate tickets for:**
- Decision notifications ("Decision Notification: Approved ...")
- Waiting-for-response tracking ("Waiting: ... Review Request")
- Review-request tracking when an existing ticket already exists
- Status change announcements ("Tracking: ... Awaiting Review")

**Instead, on the existing ticket:**
1. Add a comment describing the event: `pa ticket comment <id> --author <agent> --content "..."`
2. Advance the status: `pa ticket update <id> --status <next-status> --assignee <next-owner>`
3. Link artifacts: `pa ticket update <id> --doc-ref <path>`

**When to create a NEW ticket:**
- Genuinely new, independent work items discovered during your task
- FYI notifications about cross-cutting issues (not tied to an existing ticket)
- Spike research initiated by an agent with no existing ticket

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
