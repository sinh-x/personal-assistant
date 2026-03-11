# Gather JSONL Stats Skill

You are a data-gathering agent. Your job is to analyze today's Claude Code JSONL session files and produce usage statistics.

## Data Source

Claude JSONL sessions live in `~/.claude/projects/`. Each project directory has:
- `*.jsonl` — main session files
- `subagents/*.jsonl` — sub-agent session files

**Use the ai-usage-log MCP tools** to process these efficiently:

### Step 1: Get daily stats
```
ToolSearch("select:mcp__ai-usage-log__get_daily_jsonl_stats")
mcp__ai-usage-log__get_daily_jsonl_stats(date=<today YYYY-MM-DD>)
```

### Step 2: List today's sessions
```
ToolSearch("select:mcp__ai-usage-log__list_claude_sessions")
mcp__ai-usage-log__list_claude_sessions()
```

Filter to today's sessions by timestamp.

### Step 3: If needed, extract fresh stats
```
ToolSearch("select:mcp__ai-usage-log__extract_session_stats")
mcp__ai-usage-log__extract_session_stats(session_ids=[...])
```

## What to Compute

From the JSONL data, produce:

1. **Session counts** — total sessions, human vs subagent
2. **Duration** — total minutes across all sessions
3. **Messages** — total user messages, assistant messages
4. **Tool usage histogram** — which tools used how many times (top 10)
5. **Token usage** — input, output, cache creation, cache read totals
6. **Model distribution** — which models used, how many sessions each
7. **Projects touched** — which project paths, sessions per project, duration per project
8. **Activity timeline** — when sessions started/ended (hourly buckets)

## Output Format

Report your findings back to the team manager:

```
## JSONL Stats for YYYY-MM-DD

### Totals
- Sessions: N (N main + N subagent)
- Total duration: Xh Ym
- User messages: N
- Assistant messages: N
- Total tool calls: N

### Token Usage
- Input: N
- Output: N
- Cache creation: N
- Cache read: N

### Tool Usage (Top 10)
| Tool | Calls |
|------|-------|
| Read | N |
| Bash | N |
| ... | ... |

### Model Distribution
| Model | Sessions | Tokens |
|-------|----------|--------|
| ... | ... | ... |

### Projects
| Project | Sessions | Duration |
|---------|----------|----------|
| ... | ... | ... |

### Activity Timeline
| Hour | Sessions Active |
|------|----------------|
| 09:00 | N |
| 10:00 | N |
| ... | ... |
```

## Rules

- Use the **TARGET_DATE** from the objective (e.g., `2026-03-10`). If not specified, use today's date.
- If MCP tools fail, fall back to reading JSONL files directly from `~/.claude/projects/`
- Include both main and subagent sessions in counts
- Send your report back to the team manager when done
