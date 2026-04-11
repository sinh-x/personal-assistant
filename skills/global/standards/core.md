# Agent Standards — Core (mandatory for ALL agents, ALL modes)

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
| **ticket_id** | From `<deployment-context>` if `--ticket` was passed at deploy time, or from `$PA_TICKET_ID` env var, or discovered via `pa ticket list --assignee <team-name> --status implementing`. Value: ticket key (e.g., `PA-042`) or `none`. |

**PA Filesystem Path Resolution:**

| doc_ref style | Resolves to | Example |
|---------------|-------------|---------|
| `agent-teams/<team>/...` | `~/Documents/ai-usage/agent-teams/<team>/...` | `agent-teams/builder/artifacts/foo.md` → `~/Documents/ai-usage/agent-teams/builder/artifacts/foo.md` |
| `knowledge-base/...` | `~/Documents/ai-usage/knowledge-base/...` | `knowledge-base/repo-context/pa.md` → `~/Documents/ai-usage/knowledge-base/repo-context/pa.md` |
| `sinh-inputs/...` | `~/Documents/ai-usage/sinh-inputs/...` | `sinh-inputs/inbox/foo.md` → `~/Documents/ai-usage/sinh-inputs/inbox/foo.md` |
| `sessions/...` | `~/Documents/ai-usage/sessions/...` | `sessions/YYYY/MM/foo.md` → `~/Documents/ai-usage/sessions/YYYY/MM/foo.md` |
| `daily/...` | `~/Documents/ai-usage/daily/...` | `daily/YYYY/MM/foo.md` → `~/Documents/ai-usage/daily/YYYY/MM/foo.md` |
| `deployments/...` | `~/Documents/ai-usage/deployments/...` | `deployments/d-abc123/...` → `~/Documents/ai-usage/deployments/d-abc123/...` |
| `trash/...` | `~/Documents/ai-usage/trash/...` | `trash/...` → `~/Documents/ai-usage/trash/...` |

**Rules:**
- Never use generic names like "agent", "assistant", or "Claude"
- Always identify yourself by agent_name + team_name in logs and messages
- Pass your full identity chain when spawning sub-agents (see §3 in work.md)
- Include `ticket_id` when passing identity to sub-agents — it provides work context
- **Team-qualified assignee convention:** When setting `--assignee` on tickets, always use `<team>/<agent>` format (e.g., `builder/team-manager`, `requirements/researcher`). Bare team names (e.g., `builder`) are valid for team-level assignment. Whitelisted names (`sinh`) need no prefix. Bare agent names (e.g., `team-manager`) are deprecated and will print a warning.

---

## 2. Ticket-Objective Alignment (mandatory pre-work check)

Before starting any work, verify that the ticket and objective are aligned. This prevents agents from working on the wrong thing.

**Step 1 — Identify ticket context:**

Read `ticket_id` from `<deployment-context>`. If not present, check `$PA_TICKET_ID` env var. If neither is set, ticket is `none`.

**Step 2 — If ticket is set, read the ticket:**

```bash
pa ticket show <ticket_id>
```

**Step 3 — Alignment check:**

| Situation | Action |
|-----------|--------|
| Ticket title/summary aligns with Additional Instructions objective | Proceed normally |
| Ticket exists but objective doesn't match ticket scope | **STOP — report misalignment.** Add comment: `pa ticket comment <ticket_id> --author <agent_name> --content "MISALIGNMENT: Deployment objective does not match ticket scope. Objective: <brief>. Ticket: <brief>. Pausing for clarification."` Then exit. |
| Ticket set but not found | **STOP — report.** Write failed work report: "Ticket <id> not found." |
| No ticket set, but objective references a ticket ID | Look up the referenced ticket and adopt it. Set `ticket_id` internally. |
| No ticket, no objective | Follow team-specific startup behavior (ticket scan or wait for instructions) |

**Never proceed with doubt.** If the ticket and objective don't clearly align, pause and report back rather than guessing which one to follow.

---

## 4. File Deletion Policy

**Never hard-delete any file.** Always use `pa trash move` for file deletion.

```bash
pa trash move <path> --reason "<why>" --actor <team>/<agent> --type <skill|team|objective|mode|other>
```

Trashed files are retained for 30 days in `~/Documents/ai-usage/trash/` and can be restored with `pa trash restore <id>`. Sprint-master auto-purges expired entries during triage.

---

## 5. Error Handling

- **Never silently swallow errors.** Log them in your session and report to parent/manager.
- **On tool failure:** Try once, if it fails again report the error and move on. Do not retry in a loop.
- **On permission errors:** Log the error, skip that step, note it in Results.
- **On critical failure:** Log your session, send error report to parent, stop.
- **Always read CLI stderr output.** Warnings, reminders, and suggestions printed to stderr are actionable even when the command exits with code 0. Do not assume stderr is noise — check it after every `pa ticket` command for `doc_refs` reminders, `needs-doc-ref` tag warnings, and other guidance.

---

## 6. Shutdown Protocol

Agents shut down in this order:

1. **Sub-agents** finish and log → return results to parent agent
2. **Agents** finish all tasks and log → report completion to team manager
3. **Team manager** collects all results → writes own session log → writes registry completion marker → shuts down team → exits

**Never shut down without logging.** If you're told to shut down, log first.

**Post-completion work:** If user interaction or follow-up work occurs after the completion marker was written, amend the registry (`pa registry amend <deploy-id>`) and update the session log with `[AMENDED]` markers before shutting down.
