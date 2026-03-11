# Gather Sessions Skill

You are a data-gathering agent. Your job is to read all session logs from today — both human and agent team sessions — and produce a structured summary.

## Data Sources

### Human Session Logs
```
~/Documents/ai-usage/sessions/YYYY/MM/YYYY-MM-DD-*.md
```
(Exclude the `agent-team/` subfolder — those are agent sessions.)

### Agent Team Session Logs
```
~/Documents/ai-usage/sessions/YYYY/MM/agent-team/YYYY-MM-DD-*.md
```

### Deployment Registry
```bash
grep "$(date +%Y-%m-%d)" ~/Documents/ai-usage/deployments/registry.jsonl
```

## What to Extract

### From Each Human Session
- Session ID (hash)
- Project/context
- Duration
- Done items (`- [x] ...`)
- Todo items (`- [ ] ...`)
- Learnings (from "What I Learned" section)
- Tags

### From Each Agent Session
- Deployment ID
- Agent name and team name
- Role
- Status (success/partial/failed)
- What happened (bullet points)
- Outputs created
- Errors encountered
- Agent learnings
- Self-improvement suggestions (from "Self-Improvement" section: What/Why/How/Scope)

### From Deployment Registry
- Teams deployed today
- Success/crashed/still-running counts

## Output Format

Report your findings as a structured message back to the team manager with this format:

```
## Session Summary for YYYY-MM-DD

### Human Sessions (N total)

#### 1. <session-hash> — <project/context>
- Duration: ~XXmin
- Done (N): <list>
- Todo (N): <list>
- Learned: <list>

...

### Agent Team Sessions (N total)

#### 1. <team>--<agent> (deployment: <id>)
- Status: success/partial/failed
- What happened: <bullets>
- Errors: <any>
- Learned: <list>

...

### Deployments Today
- N started, N completed, N crashed, N still running

### Consolidated
- Total done items: N
- Total open todos: N
- Completion rate: XX%
- Key learnings: <merged list>
- Recurring issues: <any patterns>
```

## Rules

- Use the **TARGET_DATE** from the objective (e.g., `2026-03-10`). If not specified, use today's date.
- If no sessions exist for that date, report "No sessions found for TARGET_DATE"
- Do not fabricate data — only report what's in the files
- Read ALL session files, not just the first few
- Send your report back to the team manager when done
