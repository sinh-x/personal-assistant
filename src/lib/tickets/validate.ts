import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { getTeamsDir } from "../paths.js";

const AUTHOR_WHITELIST = ["sinh"];

/** Reads all team names from the `name:` field in teams/*.yaml files */
function getValidTeamNames(): Set<string> {
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
  if (AUTHOR_WHITELIST.includes(author)) return;

  const validTeams = getValidTeamNames();
  const slashIndex = author.indexOf("/");

  if (slashIndex === -1) {
    // No slash — must be a valid team name
    if (!validTeams.has(author)) {
      throw new Error(
        `Invalid author '${author}'. Must be '<team>' or '<team>/<agent>' where team matches teams/*.yaml. Allowed bare names: ${AUTHOR_WHITELIST.join(", ")}`
      );
    }
  } else {
    // Has slash — prefix must be a valid team name
    const teamPrefix = author.slice(0, slashIndex);
    if (!validTeams.has(teamPrefix)) {
      throw new Error(
        `Invalid author '${author}'. Must be '<team>' or '<team>/<agent>' where team matches teams/*.yaml. Allowed bare names: ${AUTHOR_WHITELIST.join(", ")}`
      );
    }
  }
}
