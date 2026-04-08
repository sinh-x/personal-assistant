# Workflow Policy

This document defines rules, exceptions, and edge cases for the kanban workflow.
When a rule here conflicts with `kanban-workflow.md`, **this document wins**.

> **Status:** Finalized — all sections decided (2026-03-22, PA-877 phase 2). §7 added 2026-03-22.
> Requirements approval: d-fb9804. See requirements doc for full rationale.

---

## 1. `review-uat` Skip Conditions

**Decision:** No skip conditions. Both Sinh gates are always required.

All tickets must pass Sinh's UAT review before closing from `review-uat`. No exceptions apply at this time.

**Rationale:** The system is still early-stage. Automated tests are not yet comprehensive enough to substitute for human sign-off. This policy will be revisited once test coverage is high and patterns are stable.

**Specific questions answered:**
- XS estimate tickets: **No auto-close** — size does not determine review requirement.
- Implementer self-close with pre-approval: **Not permitted** — approval at `pending-approval` does not waive UAT.
- Internal-only tooling changes: **Still require UAT** — "no user-facing impact" is a judgment call that Sinh makes, not agents.

**Future trigger for revisiting:** When `pnpm test` covers >80% of ticket workflows and a defined set of regression scenarios passes, this policy can be reopened.

---

## 2. Bug Fast-Track

**Decision:** All bugs follow the standard flow regardless of severity.

Standard flow: `idea → requirement-review → pending-approval → pending-implementation → implementing → review-uat → done`

**Rationale:** No severity classification system is defined yet. Fast-tracking without classification criteria creates ambiguity about which bugs qualify. Until a severity taxonomy is agreed, every bug follows the same pipeline.

**Specific questions answered:**
- What severity qualifies for fast-track: **None currently** — no severity taxonomy defined. All bugs use standard flow.
- Which stages can be skipped: **None** — no stages skipped until severity policy exists.
- Must Sinh be notified even if gates are bypassed: **Moot** — no bypass permitted.
- Maximum time per stage for `critical` tickets: **No SLA defined** — define alongside severity taxonomy if/when introduced.

**Future trigger for revisiting:** First occurrence of a production-blocking bug, or when Sinh defines a severity taxonomy.

---

## 3. Executor Selection (Builder vs Orchestrator)

**Decision:** Sinh sets the executor at `pending-approval`. Sprint-master may recommend but not decide.

**Rules:**
1. Sinh sets `assignee: builder` or `assignee: orchestrator` when advancing from `pending-approval` to `pending-implementation`.
2. Sprint-master may add a recommendation comment during triage (e.g., `"Recommend: orchestrator — 3 parallel sub-tasks identified"`), but the final decision is Sinh's.
3. If Sinh advances without setting an assignee, the CLI warns: "Status advanced without setting assignee — ticket may be orphaned."

**Guidance table (advisory, not policy):**

| Use `builder` | Use `orchestrator` |
|---|---|
| Single-domain change | Cross-cutting or multi-module change |
| Clear sequential steps | Parallelisable sub-tasks |
| S or M estimate | L or XL estimate |
| One repo affected | Multiple repos affected |

**Fallback if orchestrator is unavailable:** Route to builder with a comment noting the fallback. Sprint-master monitors for stalled orchestrator tickets.

---

## 4. `work-report` and `fyi` Ticket Flow

**Decision:** `work-report` and `fyi` type tickets are excluded from the active kanban board columns. FYI tickets auto-close after 7 days.

**Rules:**
1. `work-report` and `fyi` tickets do NOT appear in the standard board columns (`idea`, `requirement-review`, etc.). This is enforced by the `excludeTypes` filter in `pa board` (CLI), `GET /api/board` (API), and `buildBoardView()` (code).
2. They are visible on demand via `pa ticket list --type fyi` or `pa ticket list --type work-report`.
3. New `work-report` tickets should NOT be created — agents add completion comments directly to the working ticket instead (see `work.md` §4 for the hybrid model).
4. Legacy `work-report` tickets (from the inbox migration) flow `idea → done` directly after Sinh reads them. Sprint-master closes them in bulk during triage.
5. **FYI auto-close:** Sprint-master auto-closes FYI tickets older than 7 days to `done` status with a comment "Auto-closed: FYI ticket aged past 7 days without action." This runs during every triage (see `triage.md` Step 8b).
   - Condition: `type === "fyi"` AND `status` is not terminal AND `(now - createdAt) >= 7 days`
   - Exception: FYI tickets tagged `blocked` are NOT auto-closed.
6. **Sprint-master idea triage skips FYI tickets** — FYI tickets in `idea` status are NOT routed to the requirements team. They follow the auto-close path instead.
7. Retention: `work-report` and `fyi` tickets in terminal status (`done`, `rejected`, `cancelled`) are archived after 90 days (same as other terminal tickets via the Step 8 auto-archive rule).

**Note on work reports vs ticket comments:** The standard agent output flow is now ticket-centric. Agents post a brief completion comment on the ticket they worked on. Standalone work-report files and tickets are deprecated except for edge cases without an associated ticket.

---

## 5. Agent-Created Ideas — Routing

**Decision:** All agent-created ideas land in `idea` status first. No team may create tickets directly in `requirement-review`.

**Rules:**
1. Any agent creates ticket with `--status idea` (or omits status — default is `idea`).
2. Sprint-master picks up all `idea` tickets during triage and routes them.
3. Routing means: set `--status requirement-review`, set `--assignee requirements`, add triage comment with context.
4. No team may self-advance an `idea` to `requirement-review` — sprint-master is the single triage router.
5. Sprint-master triage cadence: at minimum once per daily-end run. High-priority ideas (`--priority high`) are checked at daily-plan time as well.

**Exception:** Sinh may directly create or advance tickets to any status — Sinh's own tickets are not gated by triage.

---

## 7. Board Cleanup Protocol

**Decision:** Sprint-master runs board cleanup during triage. Builder/team-manager may also run it ad-hoc when the board looks noisy.

Board cleanup is distinct from routine housekeeping (stale tickets, pending reviews). It targets **structural board debt**: misrouted tickets, migration artifacts, and orphaned work items.

### 7a. Inbox-Sweep Migration Artifacts

Tickets tagged `inbox-sweep` were bulk-created during the PA-002 inbox migration. Many are duplicates or already completed.

**Rules:**
1. For each `pending-implementation` ticket tagged `inbox-sweep`:
   - Check if the work is already done: search for a `done` ticket with matching title/topic
   - Check for a duplicate ticket in a better status (e.g., tagged `backlog`, with full context)
   - If either is found → cancel with a comment referencing the canonical ticket
2. Cancel command: `pa ticket update <id> --status cancelled --actor <agent>`
3. Always add a comment before or after cancelling:
   ```bash
   pa ticket comment <id> --author <agent> --content "Cancelled: work already completed — see <canonical-id>. Inbox-sweep duplicate."
   # or
   pa ticket comment <id> --author <agent> --content "Cancelled: duplicate of <canonical-id> (backlog, requirements team). Inbox-sweep artifact."
   ```
4. **Do not cancel** if no canonical ticket exists and the work is still valid — leave it and ensure `doc_refs` is populated.

### 7b. Misrouted Tickets (Wrong Project)

A ticket belongs to the wrong project when its subject clearly targets a repo other than the ticket's `--project`.

**Rules:**
1. Cross-reference the ticket's subject against `pa repos list` to identify the correct project key and ticket prefix.
2. Recreate the ticket in the correct project:
   ```bash
   pa ticket create --project <correct-key> --title "<title>" --type <type> \
     --assignee <team> --priority <p> --estimate <e> \
     --summary "<summary>. Originally tracked as <OLD-ID>. Moved to correct project." \
     --tags "<tags>" --actor <agent>
   ```
3. Cancel the original with a cross-reference comment:
   ```bash
   pa ticket update <old-id> --status cancelled --actor <agent>
   pa ticket comment <old-id> --author <agent> \
     --content "Cancelled: moved to correct project. New ticket: <NEW-ID> in <project-key>."
   ```
4. If the correct project key is unknown, do not guess — ask Sinh.

### 7c. Missing `doc_refs` Tickets

A ticket advancing through key gates should always have `doc_refs` populated so downstream teams and Sinh have full context without searching.

**At `pending-implementation` (unexecutable without a plan):**

1. For each `pending-implementation` ticket with empty `doc_refs`:
   - If the summary contains enough detail to act (clear WHAT/steps) → leave it, add a comment noting the missing doc_refs
   - If the summary is too thin to execute → add `backlog` tag with a comment:
     ```bash
     pa ticket update <id> --tags backlog --actor <agent>
     pa ticket comment <id> --author <agent> \
       --content "Tagged backlog: no doc_refs and summary insufficient to execute. Needs a plan document before implementation can start."
     ```
2. **Never attempt to implement** a ticket without either `doc_refs` or a self-contained summary.

**At `pending-approval` and `review-uat` (handoff gates):**

When the CLI detects a transition to `pending-approval` or `review-uat` without `doc_refs`, it emits a stderr warning and adds the `needs-doc-ref` tag automatically. The transition still succeeds (soft enforcement).

Sprint-master action for tickets tagged `needs-doc-ref`:
1. Identify the team that last advanced the ticket (check ticket comments or assignee history)
2. Add a comment requesting the missing document:
   ```bash
   pa ticket comment <id> --author sprint-master \
     --content "Missing doc_refs at <status> gate. <team>: please attach document with 'pa ticket update <id> --doc-ref [type:]<path>'."
   ```
3. Do NOT block the ticket status — the team can still work. The tag surfaces the gap.
4. Once doc_refs are attached, remove the `needs-doc-ref` tag via `pa ticket update <id> --tags ""` (or update tags list without it)

### 7d. Cleanup Cadence

| Who | When |
|-----|------|
| Sprint-master | At every daily-end triage run |
| Builder / team-manager | Ad-hoc, when the `pending-implementation` queue looks noisy |
| Sinh | Can request a cleanup run at any time |

---

## 6. `requirement-review` Back-Assignment Rules

**Decision:** 7-day timeout before sprint-master escalation. Requirements team cannot reject without Sinh.

**Rules:**
1. When a `requirement-review` ticket is unclear, requirements team adds a comment explaining what's missing and assigns back to the original author.
2. **7-day timeout:** If the author has not responded within 7 days, requirements team adds a comment flagging the timeout and assigns the ticket to sprint-master for escalation decision.
3. Sprint-master escalation options: (a) reach out to Sinh for clarification, (b) add `backlog` tag with expiration note, (c) close as `rejected` with Sinh's input.
4. **Requirements team cannot reject without Sinh.** Even clearly out-of-scope requests must be escalated to Sinh before closing as `rejected`.
5. Requirements team may add a `backlog` tag pending author response, but must add a comment with the 7-day deadline.
