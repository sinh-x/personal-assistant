You are running as a solo team-manager doing **routine work** — do NOT spawn sub-agents.

Your job is to cross-reference `review-uat` tickets against GitHub PRs and close tickets whose work is confirmed merged.

## Steps

### Step 1 — Workspace Setup

Create your per-deployment workspace:
```bash
mkdir -p ~/Documents/ai-usage/deployments/$PA_DEPLOYMENT_ID/team-manager
```

Team artifacts directory already exists at `~/Documents/ai-usage/agent-teams/builder/artifacts/`.

### Step 2 — Fetch review-uat Tickets

Get all PA project tickets in `review-uat` status:
```bash
pa ticket list --project pa --status review-uat --assignee sinh
```

For each ticket, you will check if the associated work has been merged.

### Step 3 — Cross-Reference Each Ticket Against GitHub

For each ticket found, search for a matching PR:

```bash
gh pr list --repo sinh-x/personal-assistant --state all --search "<TICKET-ID>" --json number,state,mergedAt,url
```

#### Decision Tree

**CASE A — PR found with state MERGED:**
- The ticket work is confirmed merged
- Update ticket to `done`:
  ```bash
  pa ticket update <TICKET-ID> --status done
  ```
- Add completion comment citing PR number and merge date:
  ```bash
  pa ticket comment <TICKET-ID> --author builder/team-manager --content "Closed: work confirmed merged via PR #<number> (<date>)."
  ```
- Record in your working notes: ticket closed, PR reference captured

**CASE F — No PR found:**
- Fall back to git log search on `develop` branch:
  ```bash
  git log develop --oneline --grep="<TICKET-ID>" | head -5
  ```
- **If commits found:** Direct-push commit (no PR). Close ticket:
  ```bash
  pa ticket update <TICKET-ID> --status done
  pa ticket comment <TICKET-ID> --author builder/team-manager --content "Closed: direct-push commit confirmed in git log (no PR)."
  ```
- **If no commits found:** Skip — do not close. The work may not be merged yet. Leave a note in your working record: ticket skipped, no merge evidence found.

### Step 4 — Produce Summary FYI Ticket

After processing all tickets, create an FYI ticket summarizing actions taken:

```bash
pa ticket create \
  --project personal-assistant \
  --title "FYI: Routine mode run — tickets closed/summary" \
  --type fyi \
  --assignee sinh \
  --priority normal \
  --estimate XS \
  --summary "Routine mode processed N review-uat tickets. Closed: M. Skipped: K. See ticket comments for individual closures."
```

### Step 5 — Session Log and Registry Completion

Write your session log per the `pa-session-log` skill, then write the registry completion marker.

#### Session Log

Save to: `~/Documents/ai-usage/sessions/$(date +%Y)/$(date +%m)/agent-team/`

Filename format: `YYYY-MM-DD-<6char-hash>-builder--team-manager--<TICKET-ID>--routine-close.md`

Required sections: `# AI Session Log`, header blockquote, `## Timeline`, `## What Happened`, `## Results`, `## Session Rating` (with self-rated scores), `## Work Quality Metrics`, `## Self-Improvement`, `## Tags`.

#### Registry Completion Marker

```bash
pa registry complete $PA_DEPLOYMENT_ID \
  --status success \
  --summary "<1-sentence summary>" \
  --log-file ~/Documents/ai-usage/sessions/YYYY/MM/agent-team/<filename>.md \
  --rating-source agent \
  --rating-overall N \
  --rating-productivity N \
  --rating-quality N \
  --rating-efficiency N \
  --rating-insight N
```

---

## Rules

- **Solo operator.** Do not spawn sub-agents.
- **No destructive git operations.** Read-only git access — only ticket status changes are made.
- **Skip blocked tickets.** If a ticket has `blocked` tag, skip it (do not attempt to close).
- **One comment per closed ticket.** Each closed ticket gets exactly one completion comment with PR/commit reference.
- **Graceful handling of empty results.** If no `review-uat` tickets are found, produce an FYI noting "0 tickets processed, none pending".
- **Copyable pattern.** Other teams can copy this objective file and adapt the `gh pr list --repo` and `git log` commands for their own use.

---

## Skill References

| Skill | Path | When to use |
|-------|------|-------------|
| pa-cli | `~/.claude/skills/pa-cli/SKILL.md` | `pa ticket` commands, enum values |
| pa-session-log | `~/.claude/skills/pa-session-log/SKILL.md` | Session log template, artifact finalization |
| pa-ticket-workflow | `~/.claude/skills/pa-ticket-workflow/SKILL.md` | Ticket lifecycle, status transitions |
| pa-startup | `~/.claude/skills/pa-startup/SKILL.md` | Startup priority order |
| pa-self-improvement | `~/.claude/skills/pa-self-improvement/SKILL.md` | Self-improvement framework |
| pa-registry | `~/.claude/skills/pa-registry/SKILL.md` | Completion marker writing |

---

## Template Pattern (for other teams)

To create a similar routine mode for another team, copy this file and change:

1. **`teams/<team>/modes/<mode>.md`** — create new mode objective
2. **`teams/<team>.yaml`** — add mode entry with `id: <mode>`, `phone_visible: true`, `provider: minimax`, `mode_type: work`, `agents: []`, `objective: teams/<team>/modes/<mode>.md`
3. **Adapt `gh pr list --repo`** and `git log` commands for the target repo
4. **Adapt ticket project/assignee filters** as needed
5. **Add skills** matching the standard skill set above

The core logic (fetch tickets → cross-reference with gh → close confirmed → produce FYI summary) is repo-agnostic and can be reused across teams.
