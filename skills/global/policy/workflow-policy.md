# Workflow Policy

This document defines rules, exceptions, and edge cases for the kanban workflow.
When a rule here conflicts with `kanban-workflow.md`, **this document wins**.

> **Status:** Skeleton — sections defined, decisions pending Sinh's input.
> Agents: treat undefined policies as "default applies" (follow kanban-workflow.md strictly).

---

## 1. `review-uat` Skip Conditions

**Default:** All tickets require Sinh's review before closing from `review-uat`.

**Policy TBD — Sinh to define:**
- Can XS estimate tickets auto-close if all automated tests pass?
- Can implementer self-close if Sinh pre-approved "no UAT needed" at `pending-approval`?
- Are internal-only tooling changes (no user-facing impact) exempt?

_Until defined: no skip conditions apply. All `review-uat` → `done` transitions require Sinh._

---

## 2. Bug Fast-Track

**Default:** Bugs follow the full flow: `idea → requirement-review → pending-approval → pending-implementation → implementing → review-uat → done`.

**Policy TBD — Sinh to define:**
- What severity/impact qualifies a bug for fast-track?
- Which stages can be skipped and under what conditions?
- Must Sinh still be notified even if gates are bypassed?
- Maximum time allowed per stage for `critical` priority tickets?

_Until defined: all bugs follow the standard flow regardless of priority._

---

## 3. Executor Selection (Builder vs Orchestrator)

**Default guidance (not yet policy):**

| Use `builder` | Use `orchestrator` |
|-------------|------------------|
| Single-domain change | Cross-cutting or multi-module |
| Clear sequential steps | Parallelisable sub-tasks |
| S or M estimate | L or XL estimate |

**Policy TBD — Sinh to define:**
- Is this decision always Sinh's at `pending-approval`, or can sprint-master recommend during triage?
- Fallback if orchestrator is unavailable?

_Until defined: Sinh sets `team: builder` or `team: orchestrator` at `pending-approval`._

---

## 4. `work-report` and `fyi` Ticket Flow

**Default:** `work-report` and `fyi` tickets are operational/communication items.
Teams do NOT create tickets for routine work reports — they write files to `sinh-inputs/inbox/`.
Sprint-master aggregates these during triage runs.

**Policy TBD — Sinh to define:**
- Should `work-report` / `fyi` type tickets be excluded from the main kanban board view?
- Retention: how long before terminal work-reports are archived?

_Until defined: work-report/fyi tickets (if any exist) flow `idea → done` directly after Sinh reads them._

---

## 5. Agent-Created Ideas — Routing

**Default:** All agent-created ideas land in `idea` status first. Sprint-master routes them during triage.

**Policy TBD — Sinh to define:**
- Can any team create tickets directly in `requirement-review` without going through `idea` first?
- Sprint-master triage cadence for processing the `idea` queue?

_Until defined: all agent ideas land in `idea`, no direct `requirement-review` creation._

---

## 6. `requirement-review` Back-Assignment Rules

**Default:** Requirements team assigns unclear tickets back to the author with a comment explaining what's missing.

**Policy TBD — Sinh to define:**
- How long to wait for author response before escalating to sprint-master?
- Can requirements team reject a ticket without Sinh's input if it's clearly out of scope?

_Until defined: requirements team waits indefinitely; cannot reject without Sinh._
