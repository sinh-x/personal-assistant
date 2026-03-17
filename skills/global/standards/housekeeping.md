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

## 10. Inbox Communication Workflow

Every team has standardized workflow folders in their persistent workspace. All agents MUST use these for cross-team and agent-to-Sinh communication.

### Folder structure (every team + Sinh)

```
~/Documents/ai-usage/agent-teams/<team_name>/
├── inbox/                  # Items arriving for you to process
├── ongoing/                # Items this team is actively working on
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
mkdir -p ~/Documents/ai-usage/agent-teams/<team_name>/{inbox,ongoing,waiting-for-response,done,archives,artifacts}
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

### Ongoing item claim/release protocol

Use `ongoing/` when you pick up a team inbox item that requires multi-step or multi-session work:

```
Team inbox/ item arrives
  ↓
Agent picks it up for multi-step work
  → move file: inbox/ → ongoing/
  → begin work

Agent work completes
  → move item: ongoing/ → done/
  → send work report to Sinh inbox/ (separate file, as usual)

Agent work fails / aborts
  → move item: ongoing/ → inbox/
  → write FYI to Sinh inbox/ explaining the failure
```

**Rules:**
- Short work that completes in a single step may go directly `inbox/` → `done/` — use judgment
- Every agent startup MUST create `ongoing/` alongside other folders (`mkdir -p` in startup step 1)
- Never leave items in `ongoing/` without attempting to move them out — the secretary stale check will re-queue items after 3 days

### When you pick up an inbox item

1. For multi-step work: move item from `inbox/` → `ongoing/` (claim it)
2. Process the item
3. On completion: move from `ongoing/` → `done/`
4. On failure/abort: move from `ongoing/` → `inbox/` + write FYI to Sinh inbox
5. If you need to respond, place the response in the **sender's** `inbox/`
6. Note in your response which `waiting-for-response/` item it resolves

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

## 11. Routing Fields: From: and To: (mandatory on all documents)

Every document you write — review-request, FYI, work report, team message — MUST include:

- **`From:`** — Your team name and agent name. The router uses this to send you a decision notification when Sinh approves or rejects your item.
- **`To:`** — The intended recipient. The router uses this to forward the document to the right team after a decision.

**Why these fields exist:**
Without `From:`, the router cannot notify the sender of the outcome — approved work goes unstarted, rejected work goes unrevised. Without `To:`, the router cannot forward the document — it becomes unroutable and lands in `secretary/pending-route/` requiring manual Sinh intervention. These fields are the connective tissue of the coordination culture.

**What breaks when missing:**
- Missing `From:` → no decision notification sent to originating team
- Missing `To:` → document becomes unroutable; goes to `pending-route/`; Sinh must manually resolve
- Missing both → both effects above; Sinh informed via `decision-needed` report

**Rules:**
- Work reports: `To: sinh` — always hardcoded, do not change
- Review requests: `To:` is the downstream team that receives the document if approved (e.g., `builder`)
- FYIs: `To:` is the team whose inbox you are writing to
- Team messages: `To:` is the recipient team inbox

**Self-validation (mandatory):** Before saving any review-request or FYI, verify both fields are populated. Missing = write error, not downstream concern.

---

## Quick Reference

```
Identity:       deployment_id + team_name + agent_name + parent
Registry:       ~/Documents/ai-usage/deployments/registry.jsonl (team manager only, flock)
Team workspace: ~/Documents/ai-usage/agent-teams/<team-name>/  (persistent, cross-deployment)
Run workspace:  ~/Documents/ai-usage/deployments/<deploy-id>/<agent-name>/  (per-deployment)
Team inbox:     ~/Documents/ai-usage/agent-teams/<team-name>/inbox/  (check on startup!)
Team ongoing:   ~/Documents/ai-usage/agent-teams/<team-name>/ongoing/  (actively working on)
Sinh inbox:     ~/Documents/ai-usage/sinh-inputs/inbox/  (items for Sinh)
Session logs:   ~/Documents/ai-usage/sessions/YYYY/MM/agent-team/
File naming:    YYYY-MM-DD-<hash>-<team>--<agent>--<topic>.md
Tags:           autonomous team:<X> agent:<Y> deployment:<Z>
Startup:        1) create workspaces (incl. ongoing/)  2) check inbox/  3) WFR self-resolve (approved|rejected|deferred) + 3-day reminder  4) incorporate active items  5) main work
Ongoing:        inbox/ → ongoing/ (start) → done/ (complete) | inbox/ (abort/fail)
Shutdown:       sub-agents → agents → manager (each logs before stopping)
```
