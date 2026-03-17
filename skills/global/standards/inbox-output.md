# Agent Standards — Inbox Output (slim reference for work/interactive modes)

Work and interactive mode agents have read-only inbox awareness: they can read inbox items and write outputs to inboxes, but skip the full housekeeping startup protocol.

---

## Writing to Inboxes

When you need to deliver output to Sinh or another team:

1. Create a markdown file: `YYYY-MM-DD-<topic>.md`
2. Place it in the **recipient's** `inbox/`:
   - Agent team: `~/Documents/ai-usage/agent-teams/<recipient-team>/inbox/`
   - Sinh: `~/Documents/ai-usage/sinh-inputs/inbox/`
3. Place a tracking copy in **your team's** `waiting-for-response/` if you expect a reply

## Reading Inbox Items

When referenced to pick up an item:
- Check `~/Documents/ai-usage/agent-teams/<team_name>/inbox/` for pending items
- For multi-step work: move item to `ongoing/` before starting
- On completion: move to `done/`

## Routing Fields: From: and To: (mandatory on all documents)

Every document you write — review-request, FYI, work report, team message — MUST include:

- **`From:`** — Your team name and agent name.
- **`To:`** — The intended recipient team or `sinh`.

**Rules:**
- Work reports: `To: sinh` — always hardcoded
- Review requests: `To:` is the downstream team that receives the document if approved
- FYIs: `To:` is the team whose inbox you are writing to

**Self-validation (mandatory):** Before saving any document, verify both fields are populated.

## Work Report Template

```markdown
# Work Report: <descriptive title>

> **Date:** YYYY-MM-DD
> **From:** <team_name> / <agent_name>
> **To:** sinh
> **Deployment:** <deploy_id>
> **Type:** work-report
> **Status:** success | partial | failed

## What Was Done
- <bullet summary>

## Outputs
- <file paths>

## Needs Attention
- <or "None">

## Suggested Next Steps
- <next action>
```

## FYI Template

```markdown
# FYI: <descriptive title>

> **Date:** YYYY-MM-DD
> **From:** <team_name> / <agent_name>
> **To:** <recipient_team_name>
> **Type:** fyi

<brief informational content>
```
