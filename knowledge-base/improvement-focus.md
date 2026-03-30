# Improvement Focus

> **Last Updated:** 2026-03-30
> **Next Update:** 2026-04-06 (weekly)
> **Source:** Self-Improvement Pipeline (PA-935)

## Top 3 Focus Items

> These items are injected into agent primers (max 10 lines, scoped by agent type).

| # | ID | Title | Category | Scope | Recurrence |
|---|----|-------|----------|-------|------------|
| 1 | IMP-2026-001 | (placeholder) | skill | builder | 1x |
| 2 | IMP-2026-002 | (placeholder) | infra | all | 1x |
| 3 | IMP-2026-003 | (placeholder) | prompt | requirements | 1x |

## Injection Format (for primer.ts)

When injected into agent primers, items are scoped by `scope` field:
- `scope: all` → included in all agent primers
- `scope: <team>` → included in primers for agents in that team
- `scope: <agent>` → included only in that specific agent's primer

Example injected section (max 10 lines total):
```markdown
## Improvement Focus

- **[IMP-2026-001]** (skill, builder) — placeholder title
- **[IMP-2026-002]** (infra, all teams) — placeholder title
- **[IMP-2026-003]** (prompt, requirements) — placeholder title
```
