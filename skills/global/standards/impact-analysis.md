# Impact Analysis — Standard Practice

Use this practice when a ticket has a `doc_ref` pointing to a plan or requirements document. Identifying impact before implementation prevents surprises and focuses the implementation on the right scope.

---

## When to Run

Run impact analysis **after reading the plan/ticket** and **before writing any code**:
- Requirements phase: during Phase 3 (technical exploration) when the ticket has `doc_ref`
- Builder phase: during pre-flight, before executing the first phase

---

## Step 1 — Identify the Change Surface

Read the plan document and extract the explicit change list:
- Files to create (new)
- Files to modify (existing)
- Files to delete or rename

Use the codebase context (from `## Repository Context` in your primer, or from Step 2 of codebase-exploration.md) to understand what each file does before assessing impact.

---

## Step 2 — Find Downstream Consumers

For each file being modified, find who uses it:

```bash
# Find imports of a TypeScript module
grep -r "from.*<module-name>" src/ --include="*.ts"

# Find callers of a function
grep -r "<function-name>" src/ --include="*.ts"

# Find references to a config/skill file
grep -r "<filename>" . --include="*.yaml" --include="*.ts" --include="*.md"
```

Document: **what consumes each changed component**, not just what it is.

---

## Step 3 — Assess Risk Per Area

For each impacted area, assign a risk level:

| Risk | Criteria |
|------|----------|
| **High** | Public API change, shared type modified, core infrastructure touched, no tests covering this area |
| **Medium** | Internal module changed, one downstream consumer, some test coverage |
| **Low** | New file (no existing callers), isolated change, existing tests cover the behavior |

Flag high-risk areas immediately — they need careful verification steps in the plan.

---

## Step 4 — Check for Hidden Dependencies

Look for non-obvious couplings:
- **Template/skill injection** — does this module get injected into primers? Check `selectModules()` and team YAMLs.
- **Config-driven behavior** — is this file referenced in YAML configs? Search `*.yaml`.
- **Build-time dependencies** — does `pnpm build` or `dart analyze` touch this path?
- **Cached state** — does any output depend on this (generated files, knowledge-base cache)?

---

## Step 5 — Document Findings

Add an `## Impact Analysis` section to the requirements document:

```markdown
## Impact Analysis

### Changed Files
| File | Change Type | Risk | Downstream Consumers |
|------|------------|------|---------------------|
| src/lib/primer.ts | Modify | Low | deploy.ts, daily.ts (via generatePrimer) |
| skills/global/standards/foo.md | New | Low | Injected into all work/interactive primers via selectModules() |

### High-Risk Areas
- None identified (all changes isolated or low-risk)

### Verification Steps
- Run `pnpm build` after all changes
- Dry-run a primer to confirm new skill is injected
```

---

## Rules

- **Never skip Step 2.** Missing a downstream consumer is the most common cause of broken deployments.
- **Risk is about blast radius, not complexity.** A one-line change to a shared type is high-risk; a 100-line new file with no callers is low-risk.
- **Use codebase context first.** If your primer has a `## Repository Context` section, check it before grepping — it may already list key patterns and entry points.
- **Document what you find, not just what you change.** Surprises you discovered during impact analysis belong in the requirements doc under Open Questions or Risks.
