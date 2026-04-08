# Template: Done Summary

> **Template:** done-summary
> **Version:** 1.0
> **Last Updated:** 2026-03-28
> **Used by:** Any team at ticket closure
> **Produces:** Closing summary for ticket moved to done
> **Consumed by:** Sprint-master (for daily digest), future auditors

## Purpose
Lightweight closing summary capturing key outcomes when a ticket moves to done.

## When to Use
- When a ticket is completed and moved to done status
- When adding a final summary comment to a closed ticket
- When sprint-master aggregates daily digests

## Template

```markdown
# Done: <ticket-id> — <short topic>

> **Closed:** YYYY-MM-DD
> **Assignee:** <team/agent>
> **Deployed:** <deployment_id(s)>

## Summary
<2-3 sentences: what was done, key outcome, value delivered>

## Key Outputs
- <artifact or file> — <brief description>
- <artifact or file> — <brief description>

## Phase Completion
- [x] Phase 1: <description>
- [x] Phase 2: <description>
- [x] Phase N: <description>

## Issues Resolved
- <ticket-id>: <brief description>
- <ticket-id>: <brief description>

## Lessons Learned
- <what went well>
- <what could be improved>

## Related
- <linked tickets, PRs, or documentation>
```

## Guidance Notes
- Keep it brief — 5-10 lines total. This is a summary, not a full report.
- Focus on outcomes and value delivered, not the implementation details
- Use this format for the ticket comment when closing: paste the Summary section
- Sprint-master reads these for daily digest aggregation

## What the Next Stage Needs
- **Sprint-master** needs: brief summary, key outputs, and phase completion for daily digest
- **Future reference** needs: related tickets, PRs, or documentation for traceability
- **No next stage** — this is the terminal lifecycle stage
