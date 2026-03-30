# Roadmap

This is a living document. Milestones are scope-based, not time-based — a milestone ships when its planned scope is complete. Scope evolves as work is discovered or reprioritized.

---

## Release Cadence

- **Minor bump** (`0.x.0`) — when a milestone's core scope is complete
- **Patch bump** (`0.3.x`) — bug fixes and small improvements between milestones
- **Major bump** (`1.0.0`) — reserved for breaking changes or architectural shifts (none planned)

Releases are tagged in git (`vX.Y.Z`) and generate a changelog section via git-cliff. See `VERSIONING.md` for bump rules.

---

## v0.4.0 — Agent Observability & Ticket System Polish

**Status:** Delivered 2026-03-24

**Retrospective:**
All planned scope was delivered. 8 milestone tickets completed (PA-899, PA-905, PA-906, PA-912, PA-914, PA-919, PA-921, PA-922). Core infrastructure: semver versioning with annotated tags, git-cliff changelog generation, ticket milestone tagging, and primer system fully operational.

**Completed Scope:**
- Ticket CLI: tag/search filtering, team/agent assignee format, FYI ticket lifecycle
- Registry CLI: `pa registry` command for agents to report completion/status
- Board & teams display: auto-filter active deployments, recent-activity views
- Primer system: REPO_KEY auto-population, unresolved variable validation
- Versioning infrastructure: VERSIONING.md, version_bump.sh with annotated tags, CHANGELOG.md via git-cliff
- Bug fixes: deployment registration, status reporting

---

## v0.5.0 — Agent Quality, CLI Polish & Skills Restructure

**Target:** May 2026

**Themes:**

| Theme | Focus | Key Tickets |
|-------|-------|-------------|
| Agent Quality & Observability | Self-improvement extraction pipeline, KPI framework | PA-935, PA-982 |
| CLI Polish & Bug Fixes | ticket show crash fix, idea/report migration to tickets | PA-988, PA-1000 |
| Skills & Primer Restructure | Claude Code skills integration, PA skills restructure | PA-952 |

**Planned Scope:**
- Self-improvement: extraction pipeline for agent session insights, KPI/KPI framework for agent performance
- Bug fixes: ticket show crash on old tickets, idea/report migration to ticket system
- Skills restructure: Claude Code skills integration, primer restructure for better agent readability
- CLI polish: improve output formatting and error messages across all commands

**Target Scope Size:** M

---

## Tagging Convention

Tickets targeting a specific milestone are tagged `milestone:vX.Y.0`:

```bash
pa ticket update <id> --tags 'milestone:v0.4.0'
pa ticket list --tags 'milestone:v0.4.0'
```

Only tag tickets where the milestone fit is clear. Ambiguous or exploratory tickets remain untagged until scoped.
