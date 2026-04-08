# Self-Improvement: Provider Comparison Skill

You are the self-improvement analyst agent running in **compare mode**. Your job is to analyze agent session behavior across providers (Anthropic vs MiniMax) by correlating deployment data with tool call patterns in activity logs, and produce actionable improvement suggestions.

## Core Concept

Provider comparison identifies behavioral differences between AI providers by analyzing:
- **PA CLI utilization** — are agents using the PA CLI for ticket/bulletin operations or doing manual file edits?
- **Dedicated tool usage** — are agents using Read/Edit/Write/Glob/Grep or raw Bash commands?
- **Skill adherence** — are agents reading relevant skill files before performing specialized tasks?
- **Git workflow quality** — clean commits vs destructive operations

## Data Locations

| Data | Path |
|------|------|
| Deployment registry | `~/Documents/ai-usage/deployments/registry.db` (SQLite) |
| Activity logs | `~/Documents/ai-usage/deployments/<deploy-id>/activity.jsonl` |
| Session logs | `~/Documents/ai-usage/sessions/YYYY/MM/agent-team/` |
| Comparison reports | `~/Documents/ai-usage/agent-teams/self-improvement/artifacts/YYYY-MM-DD-provider-comparison.md` |
| Improvement backlog | `~/Documents/ai-usage/agent-teams/self-improvement/improvement-backlog.md` |

## Mode Invocation

```
pa deploy self-improvement --mode compare [--date-range weekly|daily]
```

- **Default date range:** `weekly` (last 7 days)
- **Daily mode:** `--date-range daily` (last 1 day) for quick signals

## Algorithm

### Step 1 — Determine Date Range

Read the `improvement-backlog.md` last-scanned date, or default:
- **Weekly:** scan last 7 days of deployments
- **Daily:** scan last 1 day of deployments

### Step 2 — Read Registry and Group by Provider

Query the deployment registry via `pa registry list --since <start-date> --limit 500` or read the SQLite database directly at `~/Documents/ai-usage/deployments/registry.db`.

Filter for `started` events within the date range. For each event, extract:
- `deployment_id`
- `provider` (from event data or inference)
- `team` (from deployment_id or event)
- `mode` (if available)
- `repo` (from `started.repo` field — enables cross-project analysis)
- `timestamp`

Group deployments by provider: `anthropic` vs `minimax`.

### Step 3 — Read Activity Logs Per Deployment

For each deployment in the filtered set:

1. Read `~/Documents/ai-usage/deployments/<deploy-id>/activity.jsonl`
2. If file does not exist: skip and note in coverage metrics

Parse each activity event. Classify tool calls into categories:

| Category | Detection Pattern | Good | Bad |
|----------|-------------------|------|-----|
| **PA CLI** | Bash summary contains `pa ticket`, `pa bulletin`, `pa schedule`, `pa deploy`, `pa repo` | Using PA CLI | Manual ticket YAML edits |
| **Dedicated tools** | Tool name is Read, Edit, Write, Glob, Grep, Bash (with non-trivial commands) | Using Edit | Using Bash with sed/awk/cat |
| **Raw Bash** | Bash with `cat`, `grep`, `sed`, `awk`, `echo >`, `rm` (no tool equivalent) | — | Preferring Bash over dedicated tools |
| **Skill reads** | Read call targeting `~/.claude/skills/` path | Reading relevant skills | Ignoring loaded skills |

### Step 4 — Aggregate Metrics

For each provider, compute:

```
total_deployments = N
deployments_with_activity = M
coverage_pct = (M / N) * 100

pa_cli_usage = count(pa CLI calls) / total_calls
dedicated_tool_usage = count(Read+Edit+Write+Glob+Grep) / total_calls
raw_bash_usage = count(raw bash) / total_calls
skill_adherence = count(skill reads) / total_sessions

avg_tool_calls_per_session = total_tool_calls / total_sessions
```

Aggregate by: `provider × team × mode`

### Step 5 — Cross-Project Analysis

Using the `repo` field from registry `started` events:

- Group deployments by repo (e.g., `personal-assistant`, `avodah`, `youtube-processor`)
- Compare tool utilization patterns across repos
- Identify repo-specific issues (e.g., "Avodah sessions use 60% more raw Bash")

### Step 6 — Gap Analysis

Compare providers on each metric:

```
gap[metric] = provider_a_rate - provider_b_rate
```

Flag concerning gaps:
- Provider uses significantly more raw Bash vs dedicated tools
- Provider has lower PA CLI utilization (manual ticket operations)
- Provider rarely reads skill files
- Provider shows higher raw Git command usage (destructive patterns)

### Step 7 — Generate Improvement Suggestions

For each flagged gap, generate an actionable suggestion:

```markdown
## IMP-[YEAR]-[NNN]: [Title]

**What:** [Gap description]
**Why:** [Impact on agent quality/efficiency]
**How:** [Specific recommendation]
**Scope:** [skill/team/infra/prompt]
**Providers affected:** [anthropic/minimax/both]
**Evidence:** [Metric showing the gap]
```

Route suggestions:
- `skill` scope → update relevant skill file
- `team` scope → update team YAML or mode instructions
- `infra` scope → create maintenance ticket
- `prompt` scope → update primer generation logic

### Step 8 — Atomic Report Write

Write report to temp file, then `mv`:
`~/Documents/ai-usage/agent-teams/self-improvement/artifacts/YYYY-MM-DD-provider-comparison.md`

### Step 9 — Update Improvement Backlog

For each new suggestion:
1. Check for duplicates using (What + Scope) fuzzy match against existing backlog
2. Assign IMP ID or update recurrence on existing
3. Atomic write to backlog

### Step 10 — Create Review-Request Ticket

```bash
pa ticket create \
  --project personal-assistant \
  --title "Review: Provider Comparison $(date +%Y-%m-%d)" \
  --type review-request \
  --assignee sinh \
  --priority normal \
  --estimate M \
  --doc-ref "agent-teams/self-improvement/artifacts/YYYY-MM-DD-provider-comparison.md" \
  --summary "Provider comparison report ready. Analyzed N deployments (coverage: XX%). Found M new suggestions."
```

## Output Format

### Coverage Summary

```markdown
## Coverage Summary

| Metric | Value |
|--------|-------|
| Date range | YYYY-MM-DD to YYYY-MM-DD |
| Total deployments | N |
| Deployments with activity.jsonl | M |
| Coverage percentage | XX% |
| Anthropic deployments | N |
| MiniMax deployments | M |
```

### Per-Provider Metrics

```markdown
## Provider: anthropic

| Metric | Value |
|--------|-------|
| Deployments | N |
| PA CLI usage | XX% |
| Dedicated tool usage | XX% |
| Raw Bash usage | XX% |
| Skill adherence | XX% |
| Avg tool calls/session | N |
```

### Cross-Project Breakdown

```markdown
## Cross-Project Analysis

| Repo | Provider | Deployments | PA CLI | Dedicated | Raw Bash |
|------|----------|-------------|--------|-----------|---------|
| personal-assistant | anthropic | N | XX% | XX% | XX% |
| personal-assistant | minimax | N | XX% | XX% | XX% |
| avodah | anthropic | N | XX% | XX% | XX% |
```

### Gap Analysis

```markdown
## Gap Analysis

| Metric | Anthropic | MiniMax | Gap |
|--------|-----------|---------|-----|
| PA CLI usage | XX% | XX% | +Npp |
| Raw Bash usage | XX% | XX% | -Npp |
```

Flagged issues:
- [ ] **MiniMax raw Bash usage is 25pp higher than Anthropic** — agents may be bypassing dedicated tools
```

### Actionable Suggestions

```markdown
## Suggestions

| ID | Scope | Provider | Summary |
|----|-------|----------|---------|
| IMP-2026-NNN | skill | both | Add guidance on using Edit vs Bash |
```

## Idempotency Rules (NF1)

- Re-running for the same date range produces the same metrics (read-only analysis)
- Suggestions are deduplicated against existing backlog before addition
- Report is overwritten each run (same date range = same output)

## Error Handling (NF3)

- Missing `activity.jsonl`: skip deployment, note in coverage count, continue
- Malformed registry entries: skip entry, log warning
- Missing provider field: infer from deployment_id pattern or skip
- File read errors: skip specific file, continue analysis

## Performance (NF4)

- Always filter registry by date range before processing
- Parallel read activity files for different deployments
- Target: complete weekly analysis within 30-minute timeout
- Maximum deployments to process per run: 500 (stop and note if exceeded)

## Activity.jsonl Improvement Recommendations

The current `activity.jsonl` format has limitations. These are documented for future enhancement:

| Enhancement | What | Impact |
|-------------|------|--------|
| Add `result` field | `"success" \| "error"` on tool_call events | Would enable error-pattern analysis per provider |
| Add `duration_ms` field | Milliseconds per tool call | Would enable performance comparison |
| Add `skill_loaded` event | Emit when agent reads skill file | Would distinguish skill reads from random file reads |
| Add `pa_command` event | Structured event for pa CLI calls | Would cleanly separate PA CLI from general Bash |
| Add `error_type` field | Classify errors (permission, timeout, not_found) | Would enable root cause analysis |

See requirements doc §13 for full details.
