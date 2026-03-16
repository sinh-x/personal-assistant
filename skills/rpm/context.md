# Skill: RPM Daily Context Injection

This skill describes how to read RPM blocks and inject them into daily plan documents.
Used by the daily team (plan mode) and any agent that produces daily plan outputs.

## When to Apply

Apply this skill during daily plan generation **if and only if** the file
`~/Documents/ai-usage/agent-teams/rpm/rpm-blocks.yaml` exists.

If the file does not exist, skip silently — do not mention RPM at all.
This is opt-in: the RPM section only appears once Sinh has created blocks.

---

## Step 1 — Read RPM Blocks

```bash
cat ~/Documents/ai-usage/agent-teams/rpm/rpm-blocks.yaml 2>/dev/null
```

If the file is missing or empty, skip all remaining steps.

---

## Step 2 — Filter Active Blocks for Today

From the YAML, select blocks where **both** conditions are true:
- `status: active`
- `horizon: weekly` OR `horizon: project`

Monthly blocks (`horizon: monthly`) are included only if today is within the first 3 days of the month.

---

## Step 3 — Build "Today's RPM Focus" Section

Format as:

```markdown
## Today's RPM Focus

> Reading from ~/Documents/ai-usage/agent-teams/rpm/rpm-blocks.yaml

| ID | Area | Horizon | Result |
|----|------|---------|--------|
| r1 | work | project | Launch PA v1.0 with RPM integration |
| r2 | learning | weekly | Complete NixOS module for PA deploy |

### Active MAP Items

**r1 — Launch PA v1.0:**
- [ ] Integrate RPM context into daily plan  ← current active item
- [ ] Set up weekly gather schedule

**r2 — NixOS module:**
- [ ] Write flake module
- [ ] Test on dev machine

> Tip: Use `#rpm:r1` in an avo task name to manually map it to result r1.
```

---

## Step 4 — Label Today's Task List

For each avo task in the plan:

1. **Check for explicit tag**: if the task name contains `#rpm:rN` → map to that result ID
2. **Infer from task name**: match task name/description against active RPM results using keyword overlap
   - Match on area keywords: "learn", "study", "course" → learning area; "exercise", "gym", "run" → health
   - Match on result keywords: if task name contains words from an RPM result → use that result
3. **No match**: label as `[UNALIGNED]`

Output format for task list:

```markdown
## Today's Task List

| # | Task | Priority | Est. | RPM |
|---|------|----------|------|-----|
| 1 | Implement RPM phase 2 | P0 | 2h | r1 |
| 2 | Review NixOS flake | P1 | 1h | r2 |
| 3 | Pay bills | P2 | 30m | [UNALIGNED] |
```

---

## Step 5 — Use RPM Context for Scheduling

When scheduling tasks with avo:
- Prioritize tasks that map to `active` + `project` horizon RPM results
- If two tasks have equal avo priority, prefer the one mapped to a result with fewer MAP items done
- Flag any planning block where NO tasks map to an active result — suggest adding a task

---

## Graceful Degradation

| Scenario | Behavior |
|----------|----------|
| `rpm-blocks.yaml` does not exist | Skip entirely — no RPM section |
| File exists but is empty / malformed | Skip with a silent log note |
| File exists but 0 active blocks | Show section header with "No active RPM blocks today" |
| Anytype sync fails | No effect on daily plan — YAML is source of truth |

---

## Rules

- **Opt-in only.** Never show RPM section if blocks file is absent.
- **YAML is source of truth.** Read from `rpm-blocks.yaml`, not Anytype.
- **Don't break existing plan structure.** RPM Focus section comes after User Notes and before Today's Goals.
- **Inference over silence.** Better to infer an imperfect RPM label than leave a task unlabeled — Sinh can override with `#rpm:rN`.
- **Keep it scannable.** The focus section should be readable in 30 seconds.
