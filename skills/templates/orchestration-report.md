# Template: Orchestration Report

> **Template:** orchestration-report
> **Version:** 1.0
> **Last Updated:** 2026-04-21
> **Used by:** Builder orchestrator as the living cross-phase report
> **Produces:** Orchestration report artifact (handoff + resume source)
> **Consumed by:** Sinh (UAT / failure triage), future orchestrator runs (resume), aggregators

## Purpose

The orchestration report is the single living document that records every sub-deploy launched by the orchestrator, the review/fix cycle state, and the final outcome. It is the **primary handoff artifact** on success paths (alongside the UAT review) and the **sole handoff artifact** on partial/failure paths (post-PA-1207, the orchestrator can no longer create tickets — the report is how Sinh learns what happened).

The report is also the **resume source**: if the orchestrator is killed by `PA_MAX_RUNTIME`, the next launch reads this file to reconcile in-flight rows, read the cycle counter, and continue where the prior run left off.

## When to Use

- **Create at start:** First orchestrator launch for a ticket (Phase 0 / Phase 1). File is empty-but-structured; fields are filled as phases progress.
- **Update continuously:** On every sub-deploy launch, sub-deploy completion, cycle transition, and phase boundary (see orchestrator.md → Continuous Report Contract → Trigger events).
- **Finalize at Phase 6:** Set terminal `Status:`, populate `Final:` cycle counter, fill `Remaining Findings`, set `Resume Hint: COMPLETE`, write `Session Log` path.
- **On failure / partial exit at any phase:** Append the failure details to `## Timeline`, set `Status: partial` or `Status: failed`, attach via `pa ticket update <id> --doc-ref "orchestration:<path>"` — this is the handoff.

## Template

```markdown
### Orchestration Report: <topic>

> Ticket: <id> | Started: <ts> | Last updated: <ts>
> Status: in-progress | success | partial | failed

### Summary

<1-paragraph TL;DR of what the orchestrator is building. Written at Phase 1 after objective parsing. Covers: the goal, the scope (one sentence), and how completion is defined. Rewrite if scope changes.>

Repo: <repo_path>
Branch: <feature_branch>
PR: <PR URL — populated at Phase 5>

### Timeline
- <HH:MM> — Phase 0 (repo resolution) Orchestrator started (d-<orch-id>)
- <HH:MM> — Phase 4.1 (<brief scope>) launched d-abc123
- <HH:MM> — Phase 4.1 (<brief scope>) completed d-abc123 success
- <HH:MM> — Phase 5 (PR creation) complete — PR <url>
- <HH:MM> — Phase 5.5 (review-auto) launched d-xyz789
- ~<HH:MM> — Phase 5.5 (review-auto) completed d-xyz789 success (C0 M2 Mn1 I3)
- <HH:MM> — Phase 5.6-c1-fix launched d-fff111
- <HH:MM> — Phase 6 orchestration complete — ticket advanced to review-uat

### Sub-Deploys
| Phase | Deploy ID | Mode | Status | Severity |
|-------|-----------|------|--------|----------|
| 4.1 (<brief scope>) | d-abc123 | builder/implement | success | — |
| 5.5 (review-auto) | d-xyz789 | requirements/review-auto | success | C0 M2 Mn1 I3 |
| 5.6-c1-fix | d-fff111 | builder/implement | in-flight | — |

> Severity: C=Critical, M=Major, Mn=Minor, I=Info

### Cycles
Current: 1 / 3

<!-- In-progress form: `Current: N / 3`. Terminal form (set at Phase 6): `Final: N / 3 — <reason>` (e.g., "exited cleanly after cycle 1", "cycle cap hit with Critical remaining"). -->

### Remaining Findings (latest review)
- Critical (0): —
- Major (0): —
- Minor (1):
  - <one-line summary of finding>
- Info (2):
  - <one-line summary of finding>
  - <one-line summary of finding>

### Sub-Deploy IDs
- Implementation: d-abc123, d-def456
- Review: d-xyz789
- Fix: d-fff111

### Resume Hint
Next: Phase 5.6 cycle 1 re-review (after fix d-fff111 finishes)

<!-- On Phase 6 terminal state: `COMPLETE — no resume needed` (optionally with a one-line note about follow-up work that is NOT part of this orchestration). -->

### Orchestrator runs
- d-<orch-id-1>: started <ts>, killed <ts>, reason: runtime cap
- d-<orch-id-2>: started <ts>, in-progress

### Session Log
sessions/YYYY/MM/agent-team/<session-log-filename>.md
```

## Guidance Notes

### Status enum

`Status:` must be exactly one of:

- `in-progress` — orchestrator is running (initial state; never finalized).
- `success` — Phase 6 reached cleanly; zero qualifying findings after fix loop, or cycle cap hit with no Critical remaining.
- `partial` — Phase 6 reached but with caveats (e.g., cycle cap hit with Critical remaining), OR a non-fatal phase exited early and handed back to Sinh.
- `failed` — Phase 0 fail path (repo cannot be resolved, ticket_id missing, etc.) or any phase where the orchestration cannot continue at all. Used when the report exists but no implementation progress was made.

### Summary (top-level, written at Phase 1)

Written **after objective parsing in Phase 1** (not Phase 0 — Phase 0 may fail before the orchestrator understands what's being built). One paragraph. Cover:

1. What is being built (1 sentence)
2. Scope — the main deliverables (1 sentence)
3. Success definition — how we know it worked (1 sentence)

Rewrite the Summary if scope materially changes mid-orchestration (e.g., a phase reveals the plan was wrong). Do not append — overwrite in place.

### Metadata block (`Repo:` / `Branch:` / `PR:`)

Top-level block directly under `## Summary`. Populate:

- `Repo:` — absolute path, at Phase 0 after repo resolution
- `Branch:` — feature branch name, at Phase 4 pre-flight (after branch creation)
- `PR:` — full PR URL, at Phase 5 after `gh pr create`

The PR URL lives here (not buried inside Timeline) so Sinh can land on the report cold and reach the PR in one scroll.

### Cycles lifecycle

Two forms for the `## Cycles` section:

| Form | When | Example |
|------|------|---------|
| `Current: N / 3` | Orchestrator is running (in-progress state) | `Current: 1 / 3` |
| `Final: N / 3 — <reason>` | Phase 6 reached, terminal state | `Final: 1 / 3 — exited cleanly after cycle 1 (zero qualifying findings)` |

Rewrite the single line at Phase 6. Do not keep both forms. The global cycle counter is NEVER reset on a relaunched orchestrator — read the existing value during Resume (see orchestrator.md → Resume Playbook).

### Remaining Findings format

Fixed format. One row per severity (Critical, Major, Minor, Info), with count in parens and one-line summaries bulleted below — or `—` when zero. This prevents inconsistent reports.

```
## Remaining Findings (latest review d-<id>)
- Critical (0): —
- Major (1):
  - CQ-3: <file:line> — <one-line issue>
- Minor (2):
  - MN-1: <file:line> — <one-line issue>
  - MN-2: <file:line> — <one-line issue>
- Info (0): —
```

Severity counts are pulled from the latest review deploy's report. If review-auto was skipped (via `Skip review-auto: true`), write `- N/A: review-auto skipped by objective directive`.

### Severity legend

Include as a footer under the Sub-Deploys table in every report:

```
> Severity: C=Critical, M=Major, Mn=Minor, I=Info
```

This matches the compact `C0 M2 Mn1 I3` notation used in the Severity column.

### Phase numbering convention

Use these exact phase numbers in Timeline and Sub-Deploys rows:

| Phase number | Meaning |
|--------------|---------|
| `0` | Repo resolution (Phase 0 pre-flight) |
| `1` | Understand Objective |
| `2` | Requirements Gathering (optional) |
| `3` | Plan Analysis |
| `4.N` | Build Loop, sub-phase N (1, 2, 3, ... one per implement phase in the plan) |
| `5` | PR Creation & UAT Artifact |
| `5.5` | Review-Auto Gate (initial review) |
| `5.6-c<N>-fix` | Fix Loop, cycle N, fix sub-deploy |
| `5.6-c<N>-review` | Fix Loop, cycle N, re-review sub-deploy |
| `6` | Final Report and Shutdown |

Include a short `(<brief scope>)` in parens after the phase number in Timeline entries and Sub-Deploys rows — e.g., `Phase 4.3 (F2/F3: filter bar + clear)` or `Phase 5.5 (review-auto)`. Keep it under 40 characters.

### Timeline entry format

Each Timeline entry follows this shape:

```
<HH:MM> — Phase <N> (<brief scope>) <event> <deploy-id> [<status>]
```

Examples (from DG-094):

```
- 08:30 — Phase 4.1 (F7: server logging) launched d-e0a5f3
- 08:35 — Phase 4.1 (F7: server logging) completed d-e0a5f3 success
- ~09:20 — Phase 5.5 (review-auto) completed d-55af57 success (C0 M1 Mn3 I3)
- 09:36 — Phase 6 orchestration complete — ticket advanced to review-uat
```

Keep each entry on one line. Use `—` (em dash) as the separator between timestamp and event. Include severity counts in parens for review completion events.

### Timestamp precision

- **Exact (preferred):** pull from `pa status <deploy-id> --activity` output. No prefix.
- **Approximate:** prefix with `~` (tilde) when the exact time was not captured (e.g., the orchestrator logged the event after the fact). Example: `~09:20`.

Always use 24-hour `HH:MM` format. Do not include seconds. Do not use relative times (`Step 1`, `Step 2`) — timestamps are required for this report.

### Report as handoff artifact on failure paths

Post-PA-1207, the orchestrator **never creates tickets**. On every partial / failure path, the report is the only artifact Sinh sees. Implications:

1. Always append failure details to `## Timeline` before exiting — even on Phase 0 fails.
2. Set `Status: failed` or `Status: partial` (not `in-progress`) before exit.
3. Attach via `pa ticket update <id> --doc-ref "orchestration:<path>"` on every exit path (not just Phase 6).
4. Make the last Timeline entry actionable: Sinh should be able to read it and know the next move (retry, fix manually, abort).

This elevates the report from a "nice-to-have log" to a load-bearing document. Treat it accordingly — write to it eagerly, never skip updates.

### Session Log

Populate at Phase 6 (or on any terminal exit). Path is the manager session log location, relative to `~/Documents/ai-usage/`:

```
sessions/YYYY/MM/agent-team/<session-log-filename>.md
```

Matches the DG-094 convention. If the session log hasn't been written yet at the moment of exit, write it first, then populate this section.

### Backward compatibility

Existing orchestration reports (e.g., DG-094 at `agent-teams/builder/artifacts/2026-04-21-orchestration-dg-064-follow-up.md`) do NOT need to be rewritten to match this template. This template applies to reports generated from its publication date forward (2026-04-21).

## What the Next Stage Needs

- **Sinh (UAT / failure triage)** needs: a scannable `## Summary`, top-level `PR:` link, the latest `## Remaining Findings` summary, and an actionable last Timeline entry. Cold-landing readability is the primary design goal.
- **Future orchestrator runs (resume)** need: accurate `## Cycles` counter, reconcilable `in-flight` rows in `## Sub-Deploys`, a clear `## Resume Hint`, and `## Orchestrator runs` history to chain runs.
- **Aggregators (future tooling)** need: stable section headings, consistent severity notation, fixed `Status:` enum values. Structure is the contract.
