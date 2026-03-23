# Codebase Exploration — Standard Pattern

Use this pattern before modifying any code in an unfamiliar repo.

---

## Step 0 — Check injected context first

Your primer may contain a `## Repository Context` section with a pre-computed summary.
**If it exists, read it now and skip to Step 3.** It covers file tree, dependencies, scripts, and key patterns — no need to re-explore what is already summarized.

If the section says "No pre-computed codebase knowledge available", proceed with Steps 1–3.

---

## Step 1 — Entry points (2–3 min)

Read the project manifest to orient:

```bash
# Pick the relevant one:
cat package.json       # Node / TypeScript
cat Cargo.toml         # Rust
cat pubspec.yaml       # Dart / Flutter
cat go.mod             # Go
```

Extract:
- Language and framework version
- Main entry point (`main`, `bin`, `lib`)
- Key scripts (`build`, `test`, `dev`, `lint`)
- Top 3–5 dependencies (infer purpose from names)

---

## Step 2 — Structure scan (2–3 min)

```bash
ls -1          # top-level layout
ls src/        # (or lib/ app/ cmd/ — whatever the manifest points to)
```

Map the main directories. Common patterns:
- `src/commands/` — CLI commands
- `src/lib/` — core library modules
- `src/lib/types.ts` — shared types (always read this early)
- `skills/` — agent skill docs (PA ecosystem)
- `teams/` — team config YAMLs (PA ecosystem)
- `tests/` or `__tests__/` — test files (read to understand expected behavior)

Check for AI guidelines:
```bash
cat CLAUDE.md 2>/dev/null || cat .claude/CLAUDE.md 2>/dev/null
```
**CLAUDE.md overrides all other conventions.** Read it before touching code.

---

## Step 3 — Targeted deep dive

Read only files directly relevant to your task. Do NOT explore the full codebase.

Prioritize in this order:
1. **Files named in the plan or ticket** — read these first
2. **Types/interfaces your changes depend on** — `types.ts`, `schema.ts`, etc.
3. **The specific function/class you'll modify** — understand call sites and return shapes
4. **Tests for the area you're changing** — understand expected behavior before changing it
5. **Config or schema files** that constrain your implementation

---

## Rules

- **Read before writing.** Never modify a file you haven't read.
- **Minimal exploration.** Stop when you have enough to act — don't over-explore.
- **Trust injected context.** Pre-computed summaries are accurate; don't re-derive what's already there.
- **Note surprises.** If you discover something unexpected (unusual pattern, undocumented coupling), log it in your session's `## What I Learned` section.
- **Ask before guessing.** If architecture is unclear and the plan doesn't explain it, add a comment to the ticket before proceeding.
