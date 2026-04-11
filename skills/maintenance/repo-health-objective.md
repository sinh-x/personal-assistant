You are a SOLO operator in repo-health mode — do ALL work yourself, do NOT spawn sub-agents.

## Objective

Generate a repo health report and clean up merged branches for repository: **{{REPO_KEY}}**

Follow `skills/maintenance/repo-health.md` exactly.

## Context

- **Repo key:** `{{REPO_KEY}}`
- **Working directory:** `{{PROJECT_ROOT}}`
- **Main branch:** `{{MAIN_BRANCH}}` (from repos.yaml)
- **Develop branch:** `{{DEVELOP_BRANCH}}` (from repos.yaml)
- **Deployment ID:** `{{DEPLOY_ID}}`

## Steps

1. Resolve the repo path for `{{REPO_KEY}}`:
   ```bash
   pa repos list
   ```
   Find the entry matching `{{REPO_KEY}}` and note its absolute path, prefix, mainBranch, developBranch.

2. **Cache check** — check if previous report exists:
   ```bash
   cat ~/Documents/ai-usage/knowledge-base/repo-health/{{REPO_KEY}}.json
   ```
   If it exists, extract `generatedAt` as `lastReportAt`. If not found, `lastReportAt` is `null`.

3. **Branch analysis** — gather all branch data and classify:
   - Active: recent commits (< 30 days old)
   - Stale: no commits in 30+ days AND not merged (report only)
   - Merged: merged into main/develop (candidate for deletion)

4. **Commit stats** — gather since `lastReportAt` (or last 7 days if first run):
   - Commit count, date range, top authors

5. **Ticket stats** — query `pa ticket list --project <prefix> --status done`:
   - Filter to tickets resolved after `lastReportAt`
   - Count active tickets by status

6. **Health score** — compute 0–100 score using weighted formula:
   - Branch hygiene 40% + Commit activity 30% + Ticket throughput 30%

7. **Write all outputs:**
   - `knowledge-base/repo-health/{{REPO_KEY}}.json` — JSON snapshot
   - `knowledge-base/repo-health/{{REPO_KEY}}.md` — Markdown summary
   - `knowledge-base/repo-health.db` — SQLite row (via `src/lib/repo-health/db.ts`)

8. **Branch cleanup (two-pass):**
   - Pass 1: dry-run list of branches to delete
   - Pass 2: delete merged branches (protected: main, develop, current, release/*, hotfix/*)
   - Pass 3: `git remote prune origin`

9. **Verify** — confirm all output files exist:
   ```bash
   ls -la ~/Documents/ai-usage/knowledge-base/repo-health/{{REPO_KEY}}.*
   ```

10. **Write session log** to `~/Documents/ai-usage/sessions/YYYY/MM/agent-team/{{REPO_KEY}}-<YYYYMMDD>.md`.

11. **Report completion** — if working on a ticket:
    ```bash
    pa ticket comment <id> --author mechanic \
      --content "Repo health complete for {{REPO_KEY}}: score=<healthScore>, deleted=<N>, pruned=<M>. Output: knowledge-base/repo-health/{{REPO_KEY}}.md. Session log: sessions/YYYY/MM/agent-team/<filename>.md"
    ```
    If no ticket:
    ```bash
    pa ticket create \
      --project personal-assistant \
      --type fyi \
      --assignee sinh \
      --priority low \
      --estimate XS \
      --title "FYI: Repo health complete — {{REPO_KEY}}" \
      --summary "Health score: <healthScore>/100. Branches deleted: <N>. Remote refs pruned: <M>. Report: knowledge-base/repo-health/{{REPO_KEY}}.md."
    ```
