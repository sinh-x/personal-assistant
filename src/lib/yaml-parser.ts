import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import type { TeamConfig } from "./types.js";

/**
 * Parse a team YAML file into a typed TeamConfig.
 * Replaces ~16 sed/grep calls in deploy.sh.
 */
export function parseTeamYaml(filePath: string): TeamConfig {
  const content = readFileSync(filePath, "utf-8");
  const raw = yaml.load(content) as Record<string, unknown>;

  const agents = (raw["agents"] as Array<Record<string, string>>).map((a) => ({
    name: a["name"],
    role: a["role"],
    skill: a["skill"],
  }));

  return {
    name: raw["name"] as string,
    description: raw["description"] as string,
    context: raw["context"] as TeamConfig["context"],
    variables: raw["variables"] as Record<string, string> | undefined,
    agents,
    objective: raw["objective"] as string,
  };
}
