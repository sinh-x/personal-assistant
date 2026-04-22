# Template: Requirements

> **Template:** requirements
> **Version:** 1.0
> **Last Updated:** 2026-03-28
> **Used by:** Requirements team at requirements-gathering stage
> **Produces:** Requirements document (plan)
> **Consumed by:** Builder team (orchestrator)

## Purpose
Structured requirements document covering all checklist sections for complete handoff to builder.

## When to Use
- When starting a new requirements gathering session from an assigned ticket
- When producing a requirements document for an approved idea or feature

## Template

```markdown
# Requirements: <title>

> **Date:** YYYY-MM-DD
> **Author:** <agent_name> + <user>
> **Status:** Draft / Approved
> **Deployment:** <deployment_id>
> **Repository:** <git repo path>

## 1. Context & Background
Why are we doing this? What's the current state?

## 2. Problem Statement
What specific problem are we solving? One clear sentence.

## 3. Goals & Success Criteria
- Goal 1: ...
- Goal 2: ...
Success looks like: ...

## 4. Scope
### In Scope
- [ ] Item 1
- [ ] Item 2

### Out of Scope
- Item A (reason)
- Item B (reason)

## 5. Users & Stakeholders
Who is affected? Who cares about the outcome?

## 6. Requirements
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

## 7. Dependencies & Prerequisites
- [ ] Dependency 1 (status: ready / not ready)
- [ ] Dependency 2

## 8. Technical Approach
High-level how — architecture, patterns, key decisions.
Reference existing code/patterns found during exploration.

## 9. Risks & Unknowns
| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| ... | High/Med/Low | High/Med/Low | ... |

### Open Questions
- [ ] Question 1
- [ ] Question 2

## 10. Acceptance Criteria
- [ ] AC1: Given X, when Y, then Z
- [ ] AC2: ...

> **Note for requirements authors:** Leave §4 In Scope and §10 Acceptance Criteria items as `- [ ]` checkboxes. The builder team updates these during implementation.

## 11. Effort Estimate
- Size: S / M / L / XL
- Estimated sessions: N
- Key files to touch: list

## 12. Implementation Plan
### Steps
1. Step 1 — what to do, which files
2. Step 2 — ...

### Order of Operations
What to do first, what depends on what.

## 13. Follow-up / Future Work
Items explicitly deferred from this scope.
```

## Guidance Notes
- Every section must be addressed — write "N/A" with reason if not applicable
- §4 In Scope and §10 AC are checkboxes — builder updates these as phases complete
- Keep §6 Requirements tables scannable — prefer Must/Should/Could labels
- §8 Technical Approach should reference actual code found during exploration
- The Standard Checklist (13 sections) is the single source of truth — all requirements docs follow this structure

## What the Next Stage Needs
- **Builder team (orchestrator)** needs: §4 Scope, §6 Requirements, §10 AC, and §12 Implementation Plan
- **Repo path and branch** in §0/Context for pre-flight checks
- **Phase checklist** in §12 so orchestrator can delegate one phase at a time
- **Verification steps** in §12 for each phase so builder can confirm success

## Doc-ref Types

When attaching documents to tickets via `--doc-ref`, use the standardized type prefix:

| Type | Use for | Example |
|------|---------|---------|
| `req` | Requirements documents | `--doc-ref "req:agent-teams/requirements/artifacts/YYYY-MM-DD-topic.md"` |
| `uat` | UAT test plans | `--doc-ref "uat:agent-teams/requirements/artifacts/YYYY-MM-DD-topic-uat.md"` |
| `impl` | Implementation artifacts | `--doc-ref "impl:agent-teams/builder/artifacts/YYYY-MM-DD-topic.md"` |
| `orch` | Orchestration reports | `--doc-ref "orch:agent-teams/orchestrator/artifacts/YYYY-MM-DD-report.md"` |
| `plan` | Planning documents | `--doc-ref "plan:path/to/plan.md"` |
| `spike` | Spike reports | `--doc-ref "spike:agent-teams/requirements/artifacts/YYYY-MM-DD-spike-topic.md"` |
| `session` | Session logs | `--doc-ref "session:sessions/YYYY/MM/session-id.md"` |
| `log` | Diagnostic/export logs | `--doc-ref "log:deployments/d-abc123/session-log.md"` |
| `url` | External URLs | `--doc-ref "url:https://..."` |
| `attachment` | Generic attachments | `--doc-ref "attachment:path/to/file.pdf"` |

Use `--doc-ref-primary` to mark the primary doc_ref (typically the requirements doc).
