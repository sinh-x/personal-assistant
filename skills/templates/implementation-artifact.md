# Template: Implementation Artifact

> **Template:** implementation-artifact
> **Version:** 1.0
> **Last Updated:** 2026-03-28
> **Used by:** Builder team (implement) at implementation-complete stage
> **Produces:** Implementation artifact for UAT handoff
> **Consumed by:** Builder orchestrator and UAT reviewer

## Purpose
Structured summary of what was built, how it was verified, and what remains for UAT to confirm.

## When to Use
- When builder/implement completes all phases and hands off to UAT
- When attaching an implementation artifact to a ticket advancing to review-uat

## Template

```markdown
# Implementation: <ticket-id> — <short topic>

> **Completed:** YYYY-MM-DD
> **Agent:** <agent_name>
> **Deployment:** <deployment_id>
> **Branch:** <feature_branch>
> **Ticket:** <ticket-id>

## What Was Built
<2-3 paragraphs: what was implemented, key files created/modified, architectural decisions>

## Changes
| File | Change | Notes |
|------|--------|-------|
| <path> | created/modified | <brief description> |

### Files Created
- <list of new files with purpose>

### Files Modified
- <list of modified files with brief change description>

## Verification
<Verification steps executed and results>

### Build
- [ ] `pnpm build` — <result>
- [ ] `pnpm typecheck` — <result>

### Tests
- [ ] <test command> — <result>
- [ ] <test command> — <result>

### Manual Checks
- [ ] <check 1> — <result>
- [ ] <check 2> — <result>

## Known Limitations
- <limitation 1 and why it's acceptable>
- <limitation 2 and workaround if any>

## Open Issues
- [ ] <any follow-up issues or deferred work>

## Phase Checklist
- [x] Phase 1: <description>
- [x] Phase 2: <description>
- [x] Phase N: <description>

## Handoff Notes
<Any context the UAT reviewer or Sinh needs>
```

## Guidance Notes
- Save to `agent-teams/builder/artifacts/YYYY-MM-DD-<topic>.md` before advancing ticket
- Attach via `--doc-ref "implementation:agent-teams/builder/artifacts/..."` before status update
- Update §12 Implementation Plan checklist to show all phases complete
- Include ALL verification evidence — build output, test results, manual check results

## What the Next Stage Needs
- **UAT reviewer** needs: clear list of what was built, what files changed, and how to verify it
- **Verification commands** — exact commands to run to replicate verification
- **Known limitations** — any caveats the reviewer should be aware of
- **Phase completion status** — which phases are done so reviewer knows scope
