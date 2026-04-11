# Skill: Repo Health — Branch Cleanup + Health Report

You are the maintenance mechanic in repo-health mode. Generate a repo health report and clean up merged branches for a single repository.

## Output Paths

- **JSON**: `~/Documents/ai-usage/knowledge-base/repo-health/<slug>.json`
- **Markdown**: `~/Documents/ai-usage/knowledge-base/repo-health/<slug>.md`
- **SQLite**: `~/Documents/ai-usage/knowledge-base/repo-health.db` (historical, appended each run)

Where `<slug>` is the repo key (e.g., `pa`, `avodah`).

## JSON Schema (v1)

```json
{
  "schemaVersion": 1,
  "repoKey": "<slug>",
  "repoPath": "<absolute path>",
  "generatedAt": "<ISO 8601 timestamp>",
  "gitHead": "<current git HEAD>",
  "lastReportAt": "<ISO 8601 from previous report, or null>",
  "branchStats": {
    "total": 15,
    "merged": 3,
    "stale": 2,
    "active": 10,
    "deleted": 3,
    "remoteRefsPruned": 1
  },
  "commitStats": {
    "sinceLastReport": 42,
    "firstCommitDate": "2026-04-05",
    "lastCommitDate": "2026-04-11",
    "topAuthors": [
      { "name": "sinh", "count": 30 },
      { "name": "bot", "count": 12 }
    ]
  },
  "ticketStats": {
    "doneSinceLastReport": ["PA-1100", "PA-1101"],
    "doneCount": 2,
    "activeCount": 5,
    "byStatus": {
      "implementing": 2,
      "review-uat": 1,
      "pending-implementation": 2
    }
  },
  "staleBranches": [
    { "name": "feature/old-thing", "lastCommitDate": "2026-02-01", "daysSinceCommit": 70 }
  ],
  "mergedBranches": [
    { "name": "feature/PA-100-thing", "action": "deleted" }
  ],
  "healthScore": 85,
  "healthNotes": [
    "2 stale branches older than 60 days",
    "Good commit activity (42 commits this week)"
  ]
}
```

## Step-by-Step Process

### Step 1 — Read repo info from repos.yaml

```bash
pa repos list
```

Find the entry matching `{{REPO_KEY}}` and note:
- `path`: absolute path to the repo root
- `prefix`: project prefix (e.g., `pa`, `avodah`) for ticket queries
- `mainBranch`: protected main branch (default `main`)
- `developBranch`: protected develop branch (default `develop`)

If the repo path does not exist or is not a git repo: log a warning and exit early (skip with warning, continue to next repo).

### Step 2 — Check for previous report

Read `~/Documents/ai-usage/knowledge-base/repo-health/<slug>.json`.

If the file exists, extract `generatedAt` as `lastReportAt`. If no file exists, `lastReportAt` is `null`.

### Step 3 — Gather branch data

```bash
# All local branches with last commit date
git -C <repo_path> branch -vv --date-format="%Y-%m-%d"

# Branches merged into main (and optionally develop)
git -C <repo_path> branch -vv --merged origin/main
git -C <repo_path> branch -vv --merged origin/develop

# Count total branches
git -C <repo_path> branch -vv | wc -l
```

Classify each branch:
- **merged**: merged into main (or develop) — candidate for deletion
- **stale**: no commits in 30+ days AND not merged — report only, do NOT delete
- **active**: recent commits OR protected branch

Protected branches (never delete): `main`, `develop`, current branch, `release/*`, `hotfix/*`.

### Step 4 — Gather commit stats

```bash
# Commits since last report
if [ "$lastReportAt" != "null" ]; then
  git -C <repo_path> log --oneline --since="$lastReportAt" | wc -l
  git -C <repo_path> log --format="%aI %an" --since="$lastReportAt"
else
  # First run: last 7 days
  git -C <repo_path> log --oneline --since="7 days ago" | wc -l
  git -C <repo_path> log --format="%aI %an" --since="7 days ago"
fi

# Top authors (last 50 commits)
git -C <repo_path> log --format="%an" -50 | sort | uniq -c | sort -rn | head -5
```

### Step 5 — Query ticket completions

```bash
# Tickets done since last report (filter by project prefix)
if [ "$lastReportAt" != "null" ]; then
  pa ticket list --project <prefix> --status done --format json
  # Filter in-memory: only tickets with resolvedAt > lastReportAt
else
  # First run: all done tickets from last 7 days
  pa ticket list --project <prefix> --status done --format json
fi

# Active tickets count by status
pa ticket list --project <prefix> --status implementing
pa ticket list --project <prefix> --status "review-uat"
pa ticket list --project <prefix> --status "pending-implementation"
```

Extract ticket IDs and `resolvedAt` timestamps. Filter `doneSinceLastReport` to only include tickets resolved after `lastReportAt`.

### Step 6 — Compute health score

| Component | Weight | Score Logic |
|-----------|--------|------------|
| Branch hygiene | 40% | `100 - (stale_pct * 100) - (merged_not_cleaned * 10 each)` |
| Commit activity | 30% | `100` if commits > 0 in last 7 days, scale down linearly |
| Ticket throughput | 30% | `100` if tickets_done > 0, scale based on active-to-done ratio |

Clamp final score to 0–100.

### Step 7 — Write outputs

#### 7a — Ensure output directory exists

```bash
mkdir -p ~/Documents/ai-usage/knowledge-base/repo-health/
```

#### 7b — Write JSON snapshot

Save to `~/Documents/ai-usage/knowledge-base/repo-health/<slug>.json` using the Write tool.

#### 7c — Insert SQLite row

Use `src/lib/repo-health/db.ts` helpers (import `insertReport` and types from schema):
- Call `initRepoHealthDb()` to initialize
- Construct a `ReportInsert` object from gathered data
- Construct branch `BranchInsert` rows for each classified branch
- Call `insertReport(report, branches)`

#### 7d — Render Markdown summary

Save to `~/Documents/ai-usage/knowledge-base/repo-health/<slug>.md`:

```markdown
# Repo Health: <repoKey>

> **Generated:** <generatedAt> | **Commit:** <gitHead first 8 chars> | **Score:** <healthScore>/100

## Branch Summary

| Metric | Count |
|--------|-------|
| Total branches | <total> |
| Active | <active> |
| Merged (cleaned) | <merged_deleted> |
| Stale (30+ days) | <stale> |
| Remote refs pruned | <remoteRefsPruned> |

## Commit Activity (since <lastReportAt or "first run">)

- **Commits:** <sinceLastReport>
- **Date range:** <firstCommitDate> → <lastCommitDate>
- **Top authors:** <topAuthors as comma-separated list>

## Ticket Throughput

- **Done since last report:** <doneCount> (<doneSinceLastReport as comma-separated IDs>)
- **Active:** <activeCount> (<byStatus as key: val list>)

## Stale Branches (not deleted — reported only)

<if staleBranches.length > 0>
| Branch | Last Commit | Days Ago |
|--------|-------------|----------|
<for each stale> | <name> | <lastCommitDate> | <daysSinceCommit> |
<else> _None detected_ | (blank line) | (blank line) | (blank line) |

## Merged Branches (cleaned)

<if mergedBranches.length > 0>
- <for each merged>: `<name>` → `<action>`
<else> _None detected_ |

## Health Notes

<for each healthNote>
- <note>
```

### Step 8 — Two-pass branch cleanup

**Pass 1 — Dry run (always):**
```bash
# List branches that WOULD be deleted (merged into main, not protected)
git -C <repo_path> branch -vv --merged origin/main | grep -v "^\*\|main\|develop\|master"
```

Log the list. Then **confirm** before Pass 2.

**Pass 2 — Delete merged branches (only if not dry-run):**
```bash
# Delete each merged branch
for branch in <list_from_pass1>; do
  git -C <repo_path> branch -d "$branch"
done
```

**Pass 3 — Prune stale remote refs:**
```bash
git -C <repo_path> remote prune origin --dry-run  # preview
git -C <repo_path> remote prune origin             # actually prune
```

Count pruned refs.

### Step 9 — Write session log + completion marker

Write session log to `~/Documents/ai-usage/sessions/YYYY/MM/agent-team/<slug>-<YYYYMMDD>.md`.

Then write the completion marker:
```bash
pa registry complete <deploy-id> --status success --summary "Repo health report + branch cleanup for {{REPO_KEY}}: score=<healthScore>, deleted=<deleted>, pruned=<pruned>"
```

## Rules

- **Protected branches never deleted.** Always verify branch name against protected list before deletion.
- **Two-pass cleanup.** Always dry-run first, then execute deletion. No exceptions.
- **Skip missing repos.** If path doesn't exist or isn't a git repo, log warning and continue.
- **SQLite append-only.** Never delete rows; historical data is kept indefinitely.
- **Cache invalidation.** Always check for previous report to compute `lastReportAt`. First run uses `null`.
- **Complete all outputs.** JSON, Markdown, and SQLite row must all be written.
- **Report on completion.** Add ticket comment or create FYI ticket summarizing result.
