# Journal

Append-only log of decisions and evolution.

---

## 2026-03-10 — Genesis

- Created from insights learned by exploring ATM (Claude-Agent-Team-Manager) and yoyo-evolve
- ATM taught: deployment = structured markdown primer + `claude --dangerously-skip-permissions`
- yoyo-evolve taught: identity files, journal-driven evolution, skills as discrete units
- Decision: build own system instead of forking ATM
- Philosophy: understand the idea, extract the concept, build your own way

## 2026-03-11 — House Chores

- Initial commit of entire project from scratch (zero prior commits)
- chore: gitignore and claude config ignore (2 files)
- docs: project identity, readme, genesis journal (3 files)
- infra: core deployment script and nix packaging (2 files)
- infra: daily lifecycle and scheduling scripts (5 files)
- feat: global standards and 10 agent skills (10 files)
- feat: 5 team definitions (5 files)
- Files: 27 files across 6 commits
- Notes: Skipped `.claude/settings.local.json` (machine-specific local settings — consider adding to `.claude/.gitignore`). `.claude/ai-sessions-sinh@Drgnfly.md` correctly ignored by `.claude/.gitignore`.

## 2026-03-12 — House Chores

- docs: add inbox communication workflow (§10) to global agent standards — covers folder structure, startup checks, cross-team communication, file naming conventions; updated Quick Reference with inbox paths and startup sequence
- Files: 1 file across 1 commit
- Notes: Clean run — only one pending change found. No secrets, no ignored files.
- Suggestions: None

## 2026-03-12 — TypeScript Migration

- Decision: migrate ~1,100 lines of bash to TypeScript (Commander.js + tsup + pnpm)
- Rationale: bash pain points — manual YAML/JSON parsing (50+ sed/grep calls), fragile process management, no input validation; TS gives strict types, ecosystem alignment with other sinh-x projects (anytype-mcp, claude-devtools, openclaw)
- Phase 1: project scaffolding (package.json, tsconfig, tsup.config, lib modules)
- Phase 2: simple commands (timers, remove-timer, idea)
- Phase 3: medium commands (status, schedule) — verified output identical to bash via diff
- Phase 4: complex commands (deploy, daily, primer) — verified primer output identical to bash
- Phase 5: cleanup — deleted all 8 bash scripts, rewrote flake.nix for pnpm/TS build, updated maintenance skill and identity
- Files: 18+ files across 5 commits on feature/typescript-migration
- Key fixes: local timezone handling (localISOTimestamp), Commander.js option interception, Nix pnpmConfigHook packaging, ESM/CJS interop
- Updated IDENTITY.md: "Declarative first" now reflects TypeScript orchestration

## 2026-03-14 — Lean Queue Protocol

- Problem: `waiting-for-response/` folders became graveyards — decisions made in chat never propagated back as file moves; agents saw 6+ stale items per run with no way to distinguish resolved from open
- Solution: WFR self-resolution protocol + human workflow guide + secretary enhancements
- Phase 1 (done): Updated `skills/global/standards.md` startup sequence — agents now scan `sinh-inputs/approved|rejected|deferred/` on startup, self-close matching WFR items, and create 3-day reminders for stale items
- Phase 2 (done): Updated `~/Documents/ai-usage/WORKFLOW.md` — replaced old lifecycle diagram with new approved/rejected/deferred flow; added WFR self-resolution protocol section, "How Sinh Closes Items" quick guide, and builder team to Current Teams table
- Phase 3 (done): Published `~/Documents/ai-usage/knowledge-base/howtos/sinh-approving-items.md` — step-by-step guide for Sinh on approving/rejecting/deferring inbox items via shell mv commands or secretary interactive session; covers 3-day reminder rule, filename convention, and auto-resolution flow
- Phases remaining: update secretary coordinate.md (approve/reject/defer commands), update secretary collect.md (daily progress board + per-project tracking + orphan cleanup), update daily.yaml (secretary trigger)
- Branch: feature/lean-queue-protocol
