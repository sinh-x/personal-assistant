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

**Goals:**
- Make the ticket system more powerful and queryable (filtering, team context, lifecycle improvements)
- Improve agent-facing CLI commands so agents can self-report and observe deployment state
- Polish CLI output and display commands for daily use

**Planned Scope:**
- Ticket CLI: tag/search filtering, team/agent assignee format, FYI ticket lifecycle
- Registry CLI: `pa registry` command for agents to report completion/status
- Board & teams display: auto-filter active deployments, recent-activity views
- Primer system: REPO_KEY auto-population, unresolved variable validation
- Bug fixes: deployment registration, status reporting

**Target Scope Size:** M

---

## v0.5.0 — Multi-Repo Orchestration & Testing

**Goals:**
- Enable agent teams to operate across multiple repos in a single deployment
- Improve cross-team coordination and handoff reliability
- Add automated testing so regressions are caught before they reach production

**Planned Scope:**
- Multi-repo deploy: agents targeting different repos in one orchestration run
- Cross-team coordination improvements: structured handoffs, dependency tracking between teams
- Automated testing: unit tests for CLI commands, integration tests for ticket and registry workflows
- Orchestrator enhancements: parallel builder coordination, result aggregation

**Target Scope Size:** L

---

## Tagging Convention

Tickets targeting a specific milestone are tagged `milestone:vX.Y.0`:

```bash
pa ticket update <id> --tags 'milestone:v0.4.0'
pa ticket list --tags 'milestone:v0.4.0'
```

Only tag tickets where the milestone fit is clear. Ambiguous or exploratory tickets remain untagged until scoped.
