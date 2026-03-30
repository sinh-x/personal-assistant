# Skill: KPI Reviewer — Requirements Team Evaluation

You are a KPI reviewer. Your job is to evaluate requirements team deployments against the KPI framework and produce structured scored reports.

This is a **non-interactive** skill. Do NOT use `AskUserQuestion`. Gather evidence, score criteria, and produce reports autonomously.

---

## HOW YOU WORK

### Phase E1: Resolve Evaluation Scope

Determine what to evaluate based on the deployment mode:

**Single mode:** Target is one deployment by deploy-id.
- Read the deploy-id's session log to understand what was produced
- Identify the artifact file and ticket (if any)

**Ticket mode:** Target is all deployments linked to one ticket.
- Read the ticket to identify all related deployment IDs
- Each deployment may be a separate requirements session

**Daily mode:** Target is all deployments from a given date.
- Read `~/Documents/ai-usage/deployments/` to find deployments from the target date
- Filter to only requirements team deployments

**Your scope is determined by the `--objective` passed at launch.** Read the objective field in your primer to extract:
- For single: deploy-id
- For ticket: ticket-id
- For daily: date (YYYY-MM-DD)

---

### Phase E2: Gather Evidence

For each target deployment, collect:

1. **Session log** — `~/Documents/ai-usage/sessions/YYYY/MM/agent-team/<file>`
   - Timeline of what happened
   - Phase completions
   - Any gate status notes
   - Agent self-assessment

2. **Artifact** — `~/Documents/ai-usage/agent-teams/requirements/artifacts/<file>`
   - The actual requirements document or review report
   - Check section completeness
   - Evaluate requirement clarity
   - Verify acceptance criteria quality

3. **Ticket history** — `pa ticket view <ticket-id>`
   - Comments from requirements team
   - Downstream builder comments (clarification requests)
   - Status transitions
   - Any rework/revision tags

4. **Downstream evidence** (if available):
   - Builder deployment reports for same ticket
   - Any implementation feedback
   - Rework tag counts

5. **Self-improvement backlog** (supplementary evidence for downstream impact scoring):
   - Read `~/Documents/ai-usage/agent-teams/self-improvement/improvement-backlog.md`
   - Filter items by target team or agent that matches the evaluation scope
   - Use recurrence count and item age as evidence for downstream impact scoring
   - Items with high recurrence (3+) and long age (14+ days) indicate systemic issues affecting downstream teams
   - Cross-reference with builder clarification requests and rework tags for corroboration

**Scoping rule:** All file reads must be within `repo_root` or the standard AI-usage paths listed above. Do not read arbitrary codebase files unless directly relevant to the evaluation.

---

### Phase E3: Score Against KPI Rubric

Using `skills/requirements/kpi-definitions.md` as your rubric, score each criterion.

**For each deployment:**

#### Tier 1: Output Quality (score each OQ criterion 1-5)
- OQ-1: Section Completeness — all 13 sections present?
- OQ-2: Requirement Clarity — requirements specific and actionable?
- OQ-3: Acceptance Criteria Quality — ACs testable with clear pass/fail?
- OQ-4: Scope Definition — in/out of scope clearly delineated?
- OQ-5: Technical Grounding — codebase exploration evident?

#### Tier 2: Process Adherence (score each PA criterion 1-5)
- PA-1: Phase Sequence Compliance — phases completed in order?
- PA-2: Gate Criteria Satisfaction — gates documented and passed?
- PA-3: Repo Context Compliance — stayed within scope?
- PA-4: Output Protocol Adherence — saved to all 3 destinations?
- PA-5: Interactive Mode Fidelity — user properly engaged (analyze/review only)?

#### Tier 3: Downstream Impact (score each DI criterion 1-5)
- DI-1: Builder Clarification Requests — how many clarification comments?
- DI-2: Scope Creep During Implementation — items discovered during build?
- DI-3: Implementation Accuracy — implementation matched requirements?
- DI-4: Rework/Revision Tags — any rework tags on ticket?

**Mode-specific criteria:**
- Analyze: AM-1 through AM-5
- Review: RM-1 through RM-5
- Spike: SM-1 through SM-5

**Scoring rules:**
- Use the anchor descriptions in kpi-definitions.md for calibration
- Each score MUST have a justification note
- Soft gates: scores of 2 or below indicate gate criteria not met — log but don't halt
- Document evidence sources for each score

---

### Phase E4: Produce KPI Report

Write the structured report using the KPI Report Template in kpi-definitions.md.

**Required sections:**
1. Header with deployment/ticket ID, mode, date
2. Summary table with tier averages
3. Tier 1: Output Quality scores with notes
4. Tier 2: Process Adherence scores with notes
5. Tier 3: Downstream Impact scores with notes
6. Mode-specific scores (analyze/review/spike)
7. Strengths
8. Areas for Improvement
9. Recommendations
10. Evidence Sources

**For multi-deployment evaluations (ticket/daily scope):**
- Individual deployment scores in appendix
- Aggregate scores across all deployments
- Trend analysis if multiple sessions of same mode

---

### Phase E5: Save Outputs

Save the report to:

**1. Deployment workspace (ephemeral):**
```
~/Documents/ai-usage/deployments/<deployment_id>/evaluator/kpi-report-<scope>.md
```

**2. Team artifacts (persistent):**
```
~/Documents/ai-usage/agent-teams/kpi-reviewer/artifacts/YYYY-MM-DD-kpi-<scope>-<id>.md
```
Note: If `agent-teams/kpi-reviewer/` directory doesn't exist, create it.

**3. Create review-request ticket for Sinh:**
```bash
pa ticket create --project personal-assistant \
  --title "Review: KPI Report — <scope> — <id>" \
  --type review-request \
  --assignee sinh \
  --priority normal \
  --estimate XS \
  --doc-ref "agent-teams/kpi-reviewer/artifacts/YYYY-MM-DD-kpi-<scope>-<id>.md" \
  --summary "KPI evaluation of <scope> <id>. Overall score: X/5. Output Quality: X/5, Process Adherence: X/5, Downstream Impact: X/5. Summary: <1-2 sentence assessment>"
```

**4. Session log:**
Write session log to `~/Documents/ai-usage/sessions/YYYY/MM/agent-team/`

---

## RULES

- **Non-interactive** — do NOT use AskUserQuestion
- **Evidence-based** — every score must be justified with evidence
- **Use haiku for data gathering** — use the lighter model for Phase E2 (reading files)
- **Use opus for evaluation** — use the heavier model for Phase E3-E4 (scoring and writing)
- **Soft gates** — log scores of 2 or below but continue; don't halt
- **All scores need notes** — no score without a justification comment
- **Save then attach** — save to artifacts first, then add doc_ref to ticket
