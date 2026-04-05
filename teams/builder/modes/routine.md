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

For each ticket, first check if it has a `blocked` tag or `blockedBy` field, then search for a matching PR.

#### Pre-Check: Blocked Tickets

```bash
pa ticket show <TICKET-ID> --json | jq -r '.tags[], .blockedBy[]'
```

**CASE H — Ticket has `blocked` tag or non-empty `blockedBy`:**
- Do NOT close. Check for existing sub-ticket:
  ```bash
  pa ticket subticket list <TICKET-ID>
  ```
- If open sub-ticket titled "BLOCKED: ..." exists: SKIP (record in SKIPPED)
- Otherwise create sub-ticket:
  ```bash
  pa ticket subticket create <TICKET-ID> \
    --title "BLOCKED: Waiting on dependencies" \
    --summary "Ticket has blocked tag or blockedBy: <blocking-ids>. Action: check blocking ticket status, unblock if resolved." \
    --assignee sinh --priority low --estimate XS \
    --actor builder/team-manager
  ```
- Category: BLOCKED (sub-ticket created or skipped)

#### PR Search

For tickets that pass the blocked check, search for matching PRs:

```bash
gh pr list --repo sinh-x/personal-assistant --state all --search "<TICKET-ID>" --json number,state,headRefName,mergeable,statusCheckRollup,mergedAt,closedAt,url
```

#### Decision Tree

**CASE A — PR found, state=MERGED:**
- The ticket work is confirmed merged
- Update ticket to `done`:
  ```bash
  pa ticket update <TICKET-ID> --status done
  ```
- Add completion comment:
  ```bash
  pa ticket comment <TICKET-ID> --author builder/team-manager --content "Auto-closed: PR #<number> merged on <date>. Confirmed via gh."
  ```
- Category: CLOSED

**CASE B — PR found, state=OPEN, mergeable=MERGEABLE, checks=PASS:**
- Do NOT close. Check for existing sub-ticket:
  ```bash
  pa ticket subticket list <TICKET-ID>
  ```
- If open sub-ticket titled "READY-TO-MERGE: ..." exists: SKIP (record in SKIPPED)
- Otherwise create sub-ticket:
  ```bash
  pa ticket subticket create <TICKET-ID> \
    --title "READY-TO-MERGE: PR #<number> awaiting merge" \
    --summary "PR #<number> is open, mergeable, CI checks passing. Action: review and merge. PR URL: <url>" \
    --assignee sinh --priority medium --estimate XS \
    --actor builder/team-manager
  ```
- Category: READY-TO-MERGE (sub-ticket created or skipped)

**CASE C — PR found, state=OPEN, mergeable=CONFLICTING:**
- Do NOT close. Check for existing sub-ticket:
  ```bash
  pa ticket subticket list <TICKET-ID>
  ```
- If open sub-ticket titled "CONFLICT: ..." exists: SKIP (record in SKIPPED)
- Otherwise create sub-ticket:
  ```bash
  pa ticket subticket create <TICKET-ID> \
    --title "CONFLICT: PR #<number> has merge conflicts" \
    --summary "PR #<number> targeting develop has merge conflicts. Action: resolve conflicts and push, or close PR and create new one. PR URL: <url>" \
    --assignee sinh --priority high --estimate XS \
    --actor builder/team-manager
  ```
- Category: CONFLICT (sub-ticket created or skipped)

**CASE D — PR found, state=OPEN, checks=FAILING:**
- Do NOT close. Check for existing sub-ticket:
  ```bash
  pa ticket subticket list <TICKET-ID>
  ```
- If open sub-ticket titled "CI-FAILURE: ..." exists: SKIP (record in SKIPPED)
- Otherwise create sub-ticket:
  ```bash
  pa ticket subticket create <TICKET-ID> \
    --title "CI-FAILURE: PR #<number> checks failing" \
    --summary "PR #<number> has failing CI checks: <check-names>. Action: review failures, fix code, push update. PR URL: <url>" \
    --assignee sinh --priority high --estimate XS \
    --actor builder/team-manager
  ```
- Category: CI-FAILURE (sub-ticket created or skipped)

**CASE E — PR found, state=CLOSED (not merged):**
- Do NOT close. Check for existing sub-ticket:
  ```bash
  pa ticket subticket list <TICKET-ID>
  ```
- If open sub-ticket titled "ABANDONED: ..." exists: SKIP (record in SKIPPED)
- Otherwise create sub-ticket:
  ```bash
  pa ticket subticket create <TICKET-ID> \
    --title "ABANDONED: PR #<number> closed without merge" \
    --summary "PR #<number> was closed without merging on <date>. Action: reopen PR, create new PR, or cancel parent ticket. PR URL: <url>" \
    --assignee sinh --priority medium --estimate XS \
    --actor builder/team-manager
  ```
- Category: ABANDONED (sub-ticket created or skipped)

**CASE F — No PR found, but commits exist on develop:**
- Fall back to git log search:
  ```bash
  git log develop --oneline --grep="<TICKET-ID>" | head -5
  ```
- **If commits found:** Direct-push commit (no PR). Close ticket:
  ```bash
  pa ticket update <TICKET-ID> --status done
  pa ticket comment <TICKET-ID> --author builder/team-manager --content "Auto-closed: Commits found on develop matching <TICKET-ID> (direct push, no PR). Commits: <list>."
  ```
- Category: CLOSED
- **If no commits found:** → Case G

**CASE G — No PR found AND no matching commits:**
- Do NOT close. Check for existing sub-ticket:
  ```bash
  pa ticket subticket list <TICKET-ID>
  ```
- If open sub-ticket titled "ORPHAN: ..." exists: SKIP (record in SKIPPED)
- Otherwise create sub-ticket:
  ```bash
  pa ticket subticket create <TICKET-ID> \
    --title "ORPHAN: No PR or commits found" \
    --summary "No PR or commits found matching <TICKET-ID>. Action: verify work was done, check for alternate branch/commit naming, or reassign for implementation." \
    --assignee sinh --priority medium --estimate XS \
    --actor builder/team-manager
  ```
- Category: ORPHAN (sub-ticket created or skipped)

**CASE I — Multiple PRs found for same ticket:**
- Check if ANY PR is merged. If yes → Case A (close with note). If none merged:
  - Check for existing sub-ticket:
    ```bash
    pa ticket subticket list <TICKET-ID>
    ```
  - If open sub-ticket titled "MULTI-PR: ..." exists: SKIP (record in SKIPPED)
  - Otherwise create sub-ticket:
    ```bash
    pa ticket subticket create <TICKET-ID> \
      --title "MULTI-PR: Multiple open PRs" \
      --summary "Multiple PRs found: #<N1> (<state1>), #<N2> (<state2>). Action: determine canonical PR, close duplicates. URLs: <urls>" \
      --assignee sinh --priority medium --estimate XS \
      --actor builder/team-manager
    ```
- Category: CLOSED if any merged, MULTI-PR (sub-ticket created or skipped) if none merged

#### Error Handling

During ticket processing, handle errors gracefully so one failure does not block others:

| Error Type | Action | Category |
|------------|--------|----------|
| `gh` CLI fails (auth/network) | Log error. Fall back to git-log-only detection. Note DEGRADED in summary header. | DEGRADED |
| `pa ticket update` fails | Log error, continue to next ticket | ERROR (per-ticket) |
| `pa ticket comment` fails | Log error, continue (non-critical) | — |
| `git log` fails | Log error, skip git-based detection | ERROR |
| Too many tickets (>20) | Process first 20 by priority. Note TRUNCATED in summary. | TRUNCATED |
| Timeout approaching (>4 min) | Stop processing. Produce partial summary. | TIMEOUT |

#### Per-Ticket Error Isolation

Process tickets in batch. If one ticket fails:
1. Log the error with ticket ID and error message
2. Continue to next ticket
3. Record in ERRORS section of summary
4. Do NOT abort the entire run

### Step 4 — Produce Structured Summary

After processing all tickets, produce a structured summary as a ticket comment on the last processed ticket (or create an FYI ticket if no tickets were processed):

**Summary Template:**

```
## Routine Mode Summary — d-<deployment-id>

**Mode:** routine | **Runtime:** <elapsed> | **Provider:** MiniMax

---
### CLOSED: N tickets
| Ticket | PR/Commit | Note |
|--------|-----------|------|
| PA-XXXX | PR #N (merged <date>) | Via gh |
| PA-XXXX | commits (direct push) | Via git log |

---
### SUB-TICKETS CREATED: N
| Parent | Anomaly | Sub-Ticket ID | Action |
|--------|---------|---------------|--------|
| PA-XXXX | READY-TO-MERGE | PA-XXXX-ST-1 | Review and merge PR #N |
| PA-XXXX | CONFLICT | PA-XXXX-ST-1 | Resolve merge conflicts |
| PA-XXXX | CI-FAILURE | PA-XXXX-ST-1 | Fix failing CI checks |
| PA-XXXX | ABANDONED | PA-XXXX-ST-1 | Reopen or cancel |
| PA-XXXX | ORPHAN | PA-XXXX-ST-1 | Verify work status |
| PA-XXXX | BLOCKED | PA-XXXX-ST-1 | Check blocking deps |
| PA-XXXX | MULTI-PR | PA-XXXX-ST-1 | Determine canonical PR |

### SKIPPED (existing sub-tickets): N
| Parent | Anomaly | Existing Sub-Ticket | Status |
|--------|---------|---------------------|--------|
| PA-XXXX | CONFLICT | PA-XXXX-ST-2 | open |
| PA-XXXX | ORPHAN | PA-XXXX-ST-1 | open |

---
### ERRORS: N tickets
| Ticket | Error |
|--------|-------|
| PA-XXXX | <error message> |

---
**NOTES:** [DEGRADED / TRUNCATED / TIMEOUT if applicable]
```

**If no tickets to process:** Post comment noting "0 tickets processed, none pending."

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
- **Per-ticket error isolation.** One ticket's failure must not block others. Log errors and continue.
- **Graceful degradation.** If `gh` CLI fails, fall back to git-log-only and note DEGRADED mode.
- **Dedup before sub-ticket.** Always check `pa ticket subticket list` before creating a new sub-ticket. Skip if matching open sub-ticket exists.
- **Never close anomaly tickets.** Tickets with CONFLICT, CI-FAILURE, ABANDONED, ORPHAN, MULTI-PR, or BLOCKED status are NOT closed — create sub-tickets instead.
- **One sub-ticket per anomaly type.** Each ticket gets at most one open sub-ticket per anomaly type (dedup prevents duplicates).
- **Graceful handling of empty results.** If no `review-uat` tickets are found, produce an FYI noting "0 tickets processed, none pending".
- **20-ticket cap.** Process by priority (critical > high > medium > low). Note TRUNCATED if over 20.
- **Copyable pattern.** Other teams can copy this objective file and adapt for their own use.

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
