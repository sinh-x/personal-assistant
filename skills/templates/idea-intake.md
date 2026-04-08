# Template: Idea Intake

> **Template:** idea-intake
> **Version:** 1.0
> **Last Updated:** 2026-03-28
> **Used by:** Any team at the idea/feature stage
> **Produces:** Ticket with title, summary, and initial scope
> **Consumed by:** Requirements team

## Purpose
Structured format for capturing raw ideas and feature requests as actionable tickets.

## When to Use
- When a new feature request, bug, or improvement is identified
- Before creating a formal ticket for requirements gathering
- When Sinh or an agent surfaces a new need

## Template

```markdown
# Idea: <short title>

> **Created:** YYYY-MM-DD
> **Author:** <name>
> **Status:** Needs Requirements

## What
<One paragraph: what the user/system needs. Be specific about the end result, not the implementation.>

## Why
<One paragraph: why is this needed? What problem does it solve? What value does it add?>

## Current State
<2-3 sentences: what exists today? What is the starting point?>

## Constraints / Context
- <Any known technical constraints>
- <Any dependencies or preconditions>
- <Any audience or user information>

## Suggested Scope (draft)
- [ ] <In scope item 1>
- [ ] <In scope item 2>

### Out of Scope (draft)
- <Item explicitly not included>
- <Boundary or limitation>

## Related
- <Any existing tickets, PRs, or documentation related to this idea>
```

## Guidance Notes
- Write "What" as the end result, not the implementation approach
- Be specific — vague ideas produce vague tickets
- Constraints are optional but help requirements team prioritize
- This is a starting point, not the final requirements document

## What the Next Stage Needs
- **Requirements team** needs: clear problem statement, current state, and draft scope to begin requirements gathering
- **Priority signal**: High/Med/Low urgency and estimate (S/M/L/XL) if known
- **Any existing context**: related tickets, prior discussions, or reference materials
