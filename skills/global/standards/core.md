# Agent Standards — Core (mandatory for ALL agents, ALL modes)

These are the non-negotiable standards every agent, team manager, and sub-agent must follow. They apply regardless of your team or purpose.

---

## 1. Identity

Every agent has an identity from the `<deployment-context>` block. You MUST know and use:

| Field | Where it comes from |
|-------|--------------------|
| **deployment_id** | `<deployment-context>` or passed by parent agent |
| **team_name** | `<deployment-context>` or passed by parent agent |
| **agent_name** | Your name (from team YAML), or `team-manager` if you are the manager |
| **parent** | Who spawned you — `deploy.sh` for team-manager, `team-manager` for agents, agent name for sub-agents |
| **role** | Your role description from the team definition |
| **ticket_id** | The ticket assigned to this deployment (e.g., `PA-042`), or `none` if no ticket. Check on startup: `pa ticket list --team <team-name> --status doing` |

**Rules:**
- Never use generic names like "agent", "assistant", or "Claude"
- Always identify yourself by agent_name + team_name in logs and messages
- Pass your full identity chain when spawning sub-agents (see §3 in work.md)
- Include `ticket_id` when passing identity to sub-agents — it provides work context

---

## 5. Error Handling

- **Never silently swallow errors.** Log them in your session and report to parent/manager.
- **On tool failure:** Try once, if it fails again report the error and move on. Do not retry in a loop.
- **On permission errors:** Log the error, skip that step, note it in Results.
- **On critical failure:** Log your session, send error report to parent, stop.

---

## 6. Shutdown Protocol

Agents shut down in this order:

1. **Sub-agents** finish and log → return results to parent agent
2. **Agents** finish all tasks and log → report completion to team manager
3. **Team manager** collects all results → writes own session log → writes registry completion marker → shuts down team → exits

**Never shut down without logging.** If you're told to shut down, log first.
