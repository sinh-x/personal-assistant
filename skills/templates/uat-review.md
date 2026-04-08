# Template: UAT Review

> **Template:** uat-review
> **Version:** 1.0
> **Last Updated:** 2026-03-28
> **Used by:** Builder team at review-uat handoff
> **Produces:** UAT review checklist for ticket in review-uat status
> **Consumed by:** Sinh (UAT reviewer)

## Purpose
Checklist for preparing a ticket for UAT review — covers what was built, how to verify, and known caveats.

## When to Use
- When builder advances a ticket to review-uat status
- When preparing for final review before ticket moves to done

## Template

```markdown
# UAT Review: <ticket-id> — <short topic>

> **Ticket:** <ticket-id>
> **Requirements:** <link to requirements doc>
> **Implementation:** <link to implementation artifact>
> **Reviewer:** Sinh
> **Status:** Ready for Review

## What Was Built
<Brief (1 paragraph) summary of the implementation>

## Test Scenarios

### TS-1: <AC description>
- **Given:** <precondition>
- **When:** <action>
- **Then:** <expected result>
- **Test Command:** <command to run or steps to follow>
- **Actual Result:** _<to be filled during UAT>_
- **Status:** _<pass / fail / blocked — to be filled during UAT>_

### TS-N: <AC description>
...

## Regression Checks
- [ ] Existing functionality not broken (list key workflows to re-verify)
- [ ] Build passes (`pnpm build`)
- [ ] Typecheck passes (`pnpm typecheck`)

## Edge Cases
- <edge case 1>: <how to test / verify>
- <edge case 2>: <how to test / verify>

## Known Caveats
- <caveat 1> — <explanation>
- <caveat 2> — <explanation>

## UAT Sign-Off
- [ ] All test scenarios passed or accepted as known limitations
- [ ] Regression checks passed
- [ ] Edge cases verified or accepted as known limitations
- **Reviewer:** _<name>_
- **Date:** _<date>_
```

## Guidance Notes
- One test scenario per §10 Acceptance Criteria item — map TS-N to AC-N
- Include regression checks for the affected area
- Include edge cases from §9 Risks & Unknowns in the requirements doc
- Keep steps concrete — a reviewer should be able to follow without reading the requirements doc
- Known caveats should be noted upfront so reviewer knows what to expect

## What the Next Stage Needs
- **Sinh** needs: clear test scenarios with commands to run, known caveats noted upfront, regression checklist
- **Next stage (done)** needs: all test scenarios passed, edge cases verified or accepted, reviewer sign-off
