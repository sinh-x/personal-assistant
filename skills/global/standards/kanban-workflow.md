# Kanban Workflow — Global Standard

This document defines the ticket status lifecycle, role ownership, and transition rules for the personal-assistant agent system.

---

## Ticket Lifecycle Ownership

> **Core principle:** A ticket is only marked `done` when its final objective is achieved — not when one team or agent finishes their part.

### Rule 1 — Each team advances to the NEXT status only

Every ticket flows through the full pipeline:
```
idea → requirement-review → pending-approval → pending-implementation → implementing → review-uat → done
```

No team may skip to `done` except Sinh (via UAT sign-off). The correct advancement per role:

| Role | From | To | Must also set |
|------|------|----|---------------|
| Sprint-master | `idea` | `requirement-review` | `--assignee requirements` |
| Requirements team | `requirement-review` | `pending-approval` | `--assignee sinh`, `--doc-ref <requirements-doc>` |
| Sinh | `pending-approval` | `pending-implementation` | `--assignee builder` or `--assignee orchestrator` |
| Builder / Orchestrator | `pending-implementation` | `implementing` | `--assignee <team>/<agent-name>` |
| Builder / Orchestrator | `implementing` | `review-uat` | `--assignee sinh`, `--doc-ref <artifact>` |
| Sinh | `review-uat` | `done` | — (terminal) |

### Rule 2 — Status change = handoff

When advancing a ticket's status, the actor **MUST** also set `team` and/or `assignee` to the next owner.
If status is advanced without setting team/assignee, the CLI warns: `"Status advanced without setting team/assignee — ticket may be orphaned."`

**Additionally:** When advancing to `pending-approval` or `review-uat`, the actor **MUST** add a `--doc-ref` pointing to the requirements doc or implementation artifact. If `doc_refs` is empty at these gates, the CLI warns to stderr and adds the `needs-doc-ref` tag automatically. The transition still succeeds (soft enforcement) — but the tag signals the gap to sprint-master.

Every active ticket must have an owner. Sprint-master flags unowned active tickets during triage.

### Rule 3 — Feedback loops are explicit

When Sinh (or any gate owner) rejects or requests changes, the actor **MUST**:
1. Set status back to the appropriate earlier stage
2. Set `team` and/or `assignee` to the team responsible for rework
3. Add a comment explaining exactly what needs to change

**Example — Sinh sends back for rework:**
```bash
pa ticket update PA-042 --status implementing --assignee builder/team-manager
pa ticket comment PA-042 --author sinh --content "REWORK: API response schema is wrong. Expected { data: [] }, got { results: [] }. Fix before re-submitting for UAT."
```

### Rule 4 — No orphaned tickets

Every active ticket (any status except terminal states) must have a `team` or `assignee`.
Sprint-master reviews and re-assigns unowned tickets during each triage run.

---

## Status Flow

```
idea → requirement-review → pending-approval → pending-implementation → implementing → review-uat → done
              ↑
   (back to author if unclear)

Off-ramps at any stage: rejected | cancelled
Deprioritize: add `backlog` tag (ticket stays in current status)
```

---

## Status Definitions

### `idea`
**Who creates:** Anyone — any agent or Sinh.
Raw thought, request, or signal. Not yet scoped or committed.
- Creator writes title + one-line summary. Team/estimate not required.
- Sprint-master picks up unassigned ideas during triage and routes them.

**Out:** → `requirement-review` (routed by sprint-master) | `rejected` | `cancelled`

---

### `requirement-review`
**Owner:** Requirements team.
The idea is being elaborated into a scoped, actionable requirement.
- Requirements team writes a requirements doc → saves to `agent-teams/requirements/artifacts/`
- If the ticket is unclear: add a comment, assign back to author — do NOT guess intent
- When complete: add a `doc_ref` entry, create a review-request ticket, move to `pending-approval`

**Sinh gate — required before leaving this status.** Requirements team does not self-advance.

**Out:** → `pending-approval` (via review-request ticket to Sinh) | `idea` (back to author) | `rejected` | `cancelled`

---

### `pending-approval`
**Owner:** Sinh.
Requirements doc ready. Waiting for Sinh to review and approve.
- No agent action unless Sinh requests changes.
- Sinh approves → sets `pending-implementation`, assigns `team: builder` or `team: orchestrator`
- Sinh rejects → sets `rejected` with comment

**Out:** → `pending-implementation` (Sinh approves) | `requirement-review` (rework) | `rejected` | `cancelled`

---

### `pending-implementation`
**Owner:** Builder or orchestrator (set by Sinh at approval).
Approved and ready to build. The `team` field determines the executor:
- `team: builder` — single builder deployment, sequential work
- `team: orchestrator` — full-auto, multiple builders in parallel, orchestrator aggregates

Executor scans `pa ticket list --assignee <team> --status pending-implementation` on startup and claims the ticket.

**Out:** → `implementing` (work starts) | `cancelled`

---

### `implementing`
**Owner:** Builder (single) or orchestrator (parallel).

**Builder mode:** Works through requirements doc sequentially. Adds comments for significant decisions.

**Orchestrator mode:** Decomposes into parallel sub-tasks, launches multiple builder agents, aggregates results. Ticket stays `implementing` until all builders are done.

**Out:** → `review-uat` (complete, ready for Sinh) | `pending-implementation` (abandoned, reset) | `cancelled`

---

### `review-uat`
**Owner:** Sinh (default).
Implementation complete. Waiting for Sinh to test and validate.

Before handing off, implementer MUST add a comment:
- What was built
- How to test/verify
- Any known caveats

Then set `team: sinh`.

**Sinh gate — required before closing** unless workflow-policy.md explicitly permits auto-close.
Agents MUST consult `workflow-policy.md` before self-closing any `review-uat` ticket.

**Out:** → `done` (Sinh approves or policy permits) | `implementing` (issues found) | `rejected`

---

### `done`
Terminal. Work accepted. No further action.

### `rejected`
Terminal. Decided not to do this. Add comment with reason. Preserved for history.

### `cancelled`
Terminal. Was valid but no longer relevant. Different from rejected — no judgment on merit.

---

## Tag Reference

### `backlog` Tag

Marks a ticket as deprioritized. The ticket remains in its current status and is not deleted or closed.

**When to use:** Valid work that is not actively prioritized — paused, low-priority, or waiting for Sinh's attention.

**How to tag:**
```bash
pa ticket update <id> --tags backlog
```

**How to untag (re-activate):**
```bash
# Remove backlog from tags — include any other tags you want to keep
pa ticket update <id> --tags ""
```

**Board behavior:** The default board view excludes tickets tagged `backlog` (`GET /api/board?excludeTags=backlog,archived`). Use the Backlog view to see them: `pa ticket list --tags backlog`.

**Sprint-master behavior:** Sprint-master may add a comment suggesting backlog for stale active tickets (no updates >14 days), but does NOT add the tag — only Sinh decides.

---

### `archived` Tag

Applied automatically by sprint-master to terminal tickets (done/cancelled/rejected) older than 30 days. Non-destructive — tickets are still searchable.

**Auto-archive logic (sprint-master, daily-end triage):**
1. List all terminal tickets: `pa ticket list --status done,cancelled,rejected`
2. For each: if `(now - updatedAt) > 30 days` AND not already tagged `archived`: add `archived` tag
3. Log count of archived tickets

**Board behavior:** The default board view excludes tickets tagged `archived`. Archive view: `pa ticket list --tags archived`.

**Un-archive:** Remove the `archived` tag manually if you need to reference or reopen the ticket.

---

### `blockedBy` Field

The `blockedBy` field on a ticket contains an array of ticket IDs that must resolve before this ticket can proceed. It replaces the old `dependencies` field.

**How it works:**
- When `blockedBy` is non-empty, the `blocked` tag is automatically added to the ticket
- When `blockedBy` is cleared, the `blocked` tag is automatically removed
- The ticket stays in its current status — `blockedBy` describes the dependency, not the work state

**CLI usage:**
```bash
# Block on one or more tickets
pa ticket update <id> --blocked-by PA-100,PA-101

# Clear blockedBy (unblock)
pa ticket update <id> --blocked-by ""
```

**Sprint-master:** Monitors tickets with `blocked` tag during triage and escalates if unresolved after 24h.

---

## Blocked Tag Protocol

`blocked` is a **tag**, not a status. `blocked` must never appear as a status value — it belongs in `--tags` only.

There are two ways a ticket becomes blocked:

**1. Blocked by another ticket** — use `--blocked-by` (preferred):
```bash
# Block on a specific ticket
pa ticket update <id> --blocked-by PA-100
# → auto-adds 'blocked' tag; ticket stays in current status

# Clear when resolved
pa ticket update <id> --blocked-by ""
# → auto-removes 'blocked' tag
```

**2. Blocked by an external factor** (decision, missing info, etc.) — use tags manually:
```bash
# Add blocked tag manually
pa ticket update <id> --tags blocked

# Add comment explaining what's needed
pa ticket comment <id> --author <agent> --content "BLOCKED: <reason>. Waiting on: <decision or external dependency>."

# When unblocked: update tags to remove 'blocked', add resolution comment
```

Sprint-master monitors tickets with `blocked` tag during triage and escalates if unresolved after 24h.

---

## Sinh's Gates (Non-Negotiable)

| Gate | Transition | What Sinh does |
|------|-----------|----------------|
| Requirements approval | `requirement-review` → `pending-approval` → `pending-implementation` | Reads doc, approves or rejects |
| UAT sign-off | `review-uat` → `done` | Tests/validates — unless policy permits skip |

**Agents MUST NOT advance tickets past these gates themselves** without explicit policy permission.

---

## Role Summary

| Role | Statuses they own | Tag responsibilities |
|------|-------------------|---------------------|
| Any agent / Sinh | Create `idea` tickets | — |
| Sprint-master | Triage `idea` → route to requirements | Add `archived` tag (auto, daily-end); suggest `backlog` (comment only, Sinh decides); monitor `blocked` tag |
| Requirements team | Own `requirement-review` — elaborate, clarify, or assign back to author | — |
| Sinh | Gate at `pending-approval` and `review-uat` | Approve `backlog` suggestions; un-archive tickets |
| Builder | `pending-implementation` → `implementing` → `review-uat` (single-team) | — |
| Orchestrator | `pending-implementation` → `implementing` → `review-uat` (parallel builders) | — |
