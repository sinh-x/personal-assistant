# Kanban Workflow — Global Standard

This document defines the ticket status lifecycle, role ownership, and transition rules for the personal-assistant agent system.

---

## Status Flow

```
idea → requirement-review → pending-approval → pending-implementation → implementing → review-uat → done
              ↑
   (back to author if unclear)

Off-ramps at any stage: on-hold | rejected | cancelled
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
- When complete: attach `doc_ref`, create a review-request ticket, move to `pending-approval`

**Sinh gate — required before leaving this status.** Requirements team does not self-advance.

**Out:** → `pending-approval` (via review-request ticket to Sinh) | `idea` (back to author) | `rejected` | `on-hold`

---

### `pending-approval`
**Owner:** Sinh.
Requirements doc ready. Waiting for Sinh to review and approve.
- No agent action unless Sinh requests changes.
- Sinh approves → sets `pending-implementation`, assigns `team: builder` or `team: orchestrator`
- Sinh rejects → sets `rejected` with comment

**Out:** → `pending-implementation` (Sinh approves) | `requirement-review` (rework) | `rejected` | `on-hold`

---

### `pending-implementation`
**Owner:** Builder or orchestrator (set by Sinh at approval).
Approved and ready to build. The `team` field determines the executor:
- `team: builder` — single builder deployment, sequential work
- `team: orchestrator` — full-auto, multiple builders in parallel, orchestrator aggregates

Executor scans `pa ticket list --team <team> --status pending-implementation` on startup and claims the ticket.

**Out:** → `implementing` (work starts) | `on-hold`

---

### `implementing`
**Owner:** Builder (single) or orchestrator (parallel).

**Builder mode:** Works through requirements doc sequentially. Adds comments for significant decisions.

**Orchestrator mode:** Decomposes into parallel sub-tasks, launches multiple builder agents, aggregates results. Ticket stays `implementing` until all builders are done.

**Out:** → `review-uat` (complete, ready for Sinh) | `on-hold` | `pending-implementation` (abandoned, reset)

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

### `on-hold`
Parking. Valid work, paused. Can resume to any active status.
Set `on-hold` + comment explaining why. Sprint-master reviews on-hold tickets weekly.

---

## Sinh's Gates (Non-Negotiable)

| Gate | Transition | What Sinh does |
|------|-----------|----------------|
| Requirements approval | `requirement-review` → `pending-approval` → `pending-implementation` | Reads doc, approves or rejects |
| UAT sign-off | `review-uat` → `done` | Tests/validates — unless policy permits skip |

**Agents MUST NOT advance tickets past these gates themselves** without explicit policy permission.

---

## Role Summary

| Role | Statuses they own |
|------|-------------------|
| Any agent / Sinh | Create `idea` tickets |
| Sprint-master | Triage `idea` → route to requirements |
| Requirements team | Own `requirement-review` — elaborate, clarify, or assign back to author |
| Sinh | Gate at `pending-approval` and `review-uat` |
| Builder | `pending-implementation` → `implementing` → `review-uat` (single-team) |
| Orchestrator | `pending-implementation` → `implementing` → `review-uat` (parallel builders) |
