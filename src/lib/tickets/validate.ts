import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { getTeamsDir } from "../paths.js";

const BARE_NAME_WHITELIST = ["sinh"];

/** Reads all team names from the `name:` field in teams/*.yaml files */
export function getValidTeamNames(): Set<string> {
  const teamsDir = getTeamsDir();
  const names = new Set<string>();
  try {
    const files = readdirSync(teamsDir).filter((f) => f.endsWith(".yaml"));
    for (const file of files) {
      try {
        const content = readFileSync(resolve(teamsDir, file), "utf-8");
        const raw = yaml.load(content) as Record<string, unknown>;
        if (typeof raw["name"] === "string" && raw["name"]) {
          names.add(raw["name"]);
        }
      } catch {
        // skip unparseable files
      }
    }
  } catch {
    // teams dir not accessible — return empty set
  }
  return names;
}

/**
 * Validates a team-qualified name (team/agent or bare team).
 * Shared logic for both author and assignee validation.
 *
 * Returns void on success. Throws an Error with actionable message on invalid input.
 */
function validateTeamQualifiedName(
  value: string,
  fieldName: string,
  validTeams: Set<string>,
): void {
  const slashIndex = value.indexOf("/");

  if (slashIndex === -1) {
    // No slash — must be a valid team name
    if (!validTeams.has(value)) {
      const teamList = [...validTeams].sort().join(", ");
      throw new Error(
        `Invalid ${fieldName} '${value}'. Must be '<team>' or '<team>/<agent>' where team matches teams/*.yaml. Valid teams: ${teamList}. Allowed bare names: ${BARE_NAME_WHITELIST.join(", ")}`
      );
    }
  } else {
    // Has slash — prefix must be a valid team name
    const teamPrefix = value.slice(0, slashIndex);
    if (!validTeams.has(teamPrefix)) {
      const teamList = [...validTeams].sort().join(", ");
      throw new Error(
        `Invalid ${fieldName} '${value}'. Team '${teamPrefix}' not found. Valid teams: ${teamList}. Allowed bare names: ${BARE_NAME_WHITELIST.join(", ")}`
      );
    }
  }
}

/**
 * Validates the comment author field.
 *
 * Valid formats:
 *   - Whitelisted bare name: "sinh"
 *   - Team-only: "<team>"  (name: field from teams/*.yaml)
 *   - Team + agent: "<team>/<agent>"
 *
 * Throws an Error with an actionable message on invalid input.
 */
export function validateAuthor(author: string): void {
  if (BARE_NAME_WHITELIST.includes(author)) return;
  validateTeamQualifiedName(author, "author", getValidTeamNames());
}

/**
 * Validates the ticket assignee field.
 *
 * Valid formats:
 *   - Whitelisted bare name: "sinh" — no team prefix required
 *   - Team-only: "<team>" (e.g., "requirements") — team-level assignment
 *   - Team + agent: "<team>/<agent>" (e.g., "requirements/team-manager") — validate team prefix
 *   - Bare agent name: "team-manager" — prints deprecation warning but ACCEPTS (soft warning)
 *
 * Throws an Error when team prefix is invalid (not found in teams/*.yaml).
 */
export function validateAssignee(assignee: string): void {
  if (BARE_NAME_WHITELIST.includes(assignee)) return;

  const validTeams = getValidTeamNames();
  const slashIndex = assignee.indexOf("/");

  if (slashIndex === -1) {
    // Bare name — could be team-only or bare agent (deprecated)
    if (validTeams.has(assignee)) return; // team-only assignment: ok

    // Bare agent name: warn (deprecation) but accept
    const teamList = [...validTeams].sort().join(", ");
    process.stderr.write(
      `Warning: Bare assignee '${assignee}' is deprecated. Use '<team>/${assignee}' format. Valid teams: ${teamList}\n`
    );
    return; // soft warning, not an error
  }

  // team/agent format — validate team prefix
  const teamPrefix = assignee.slice(0, slashIndex);
  if (!validTeams.has(teamPrefix)) {
    const teamList = [...validTeams].sort().join(", ");
    throw new Error(
      `Invalid assignee '${assignee}'. Team '${teamPrefix}' not found. Valid teams: ${teamList}. Allowed bare names: ${BARE_NAME_WHITELIST.join(", ")}`
    );
  }
}

/**
 * Smart assignee matching for ticket list filtering.
 * Supports exact match, team-prefix match, and bare-agent-suffix match.
 */
export function matchAssignee(ticketAssignee: string, filterAssignee: string): boolean {
  // Exact match
  if (ticketAssignee === filterAssignee) return true;

  // Filter has no slash — could be team or bare agent name
  if (!filterAssignee.includes("/")) {
    const validTeams = getValidTeamNames();
    if (validTeams.has(filterAssignee)) {
      // Team filter: match any ticket starting with "filterAssignee/"
      return ticketAssignee.startsWith(filterAssignee + "/");
    }
    // Bare agent filter: match any ticket ending with "/filterAssignee"
    return ticketAssignee.endsWith("/" + filterAssignee);
  }

  return false;
}
