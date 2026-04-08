# Template: Builder Objective

> **Template:** builder-objective
> **Version:** 1.0
> **Last Updated:** 2026-03-28
> **Used by:** Builder orchestrator at Phase 3→4 handoff
> **Produces:** Structured objective for builder/implement sub-deployment
> **Consumed by:** Builder team (implement mode)

## Purpose
Structured format for orchestrator→builder handoff, containing all context needed to execute one phase.

## When to Use
- When orchestrator launches a builder/implement sub-deployment
- When composing the objective for each implementation phase

## Template

```markdown
Phase N of <item-filename>: <phase description from checklist>

## Scope
<List the §4 In Scope items this phase addresses, as checkboxes>

## Requirements
### Functional
| # | Requirement | Priority | Notes |
|---|-------------|----------|-------|
| F1 | ... | Must | ... |
| F2 | ... | Should | ... |

### Non-Functional
| # | Requirement | Priority | Notes |
|---|-------------|----------|-------|
| NF1 | Performance: ... | Must | ... |
| NF2 | Security: ... | Should | ... |

## Acceptance Criteria
<List the §10 AC items that become verifiable after this phase, as checkboxes>
Note: `(partial — full verification after Phase M)` if AC spans multiple phases.

## Verification
<Ordered list of verification steps for this phase: build commands, test commands, manual checks>

## Context
- Repo: <repo_path>
- Branch: <feature_branch> (already checked out by orchestrator — implement must verify, not create)
- Plan: <path to plan document>
- Prior phases completed: <list of completed phase numbers, or "none">
- Dependencies: <any §7 items or prior-phase outputs this phase needs>
```

## Guidance Notes
- Include ONLY requirements, NFRs, and ACs relevant to THIS phase — not the entire plan
- Always include all "Must" priority NFRs as baseline context
- If an AC spans multiple phases, include it in the EARLIEST phase where partially testable
- If a phase has no mapped ACs, flag the gap: add `No acceptance criteria mapped to this phase`
- Keep the objective readable — concise bullets over paragraphs

## What the Next Stage Needs
- **Builder/implement** needs: exact scope for this phase, verification commands to run, and any dependencies on prior phases
- **Branch already checked out** — implement verifies, does not create
- **Prior phase outputs** — list any artifacts or outputs from previous phases this phase depends on
- **Repo path** — for pre-flight branch verification
