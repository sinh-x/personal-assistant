# Agent Standards — Inbox Output (DEPRECATED)

> **Status:** DEPRECATED as of 2026-03-21
> **Replaced by:** Ticket system (`pa ticket` CLI commands)
> **See:** `skills/global/standards/work.md` §4 (Work Report, Review Request, FYI) and §5 (Ticket Workflow)

---

This file described the file-based inbox communication protocol:
- Writing markdown files to `~/Documents/ai-usage/agent-teams/<team>/inbox/`
- Writing work reports to `~/Documents/ai-usage/sinh-inputs/inbox/`
- Managing `From:` and `To:` routing fields
- Moving items through `inbox/ → ongoing/ → done/`

**That protocol is replaced by the ticket system.** All cross-team and agent-to-Sinh communication now uses tickets:

| Old action | New action |
|-----------|-----------|
| Write work report file to `sinh-inputs/inbox/` | `pa ticket create --type work-report --assignee sinh` |
| Write review-request file to `sinh-inputs/inbox/` | `pa ticket create --type review-request --assignee <downstream>` |
| Write FYI file to `<team>/inbox/` | `pa ticket create --type fyi --assignee <recipient>` |
| Check `<team>/inbox/` for pending work | `pa ticket list --assignee <team-name> --status pending-implementation` |
| Move item `inbox/ → ongoing/` to claim | `pa ticket update <id> --status implementing --assignee <agent>` |
| Move item `ongoing/ → done/` on completion | `pa ticket update <id> --status done` |

**For full ticket workflow documentation**, see:
- `skills/global/standards/work.md` — §4 Session Logging (work reports, review requests, FYIs), §5 Ticket Workflow, §6 Bulletin Awareness
- `skills/global/standards/housekeeping.md` — §10 Ticket Housekeeping (startup checks for housekeeping mode)

---

> This file is kept for backwards compatibility during the transition period.
> Do not add new content here. All new standards go in `work.md`.
