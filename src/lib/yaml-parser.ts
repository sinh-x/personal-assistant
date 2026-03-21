import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import type { TeamConfig, DeployMode, Hierarchy, HierarchyMember } from "./types.js";

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
    model: a["model"] as TeamConfig["model"] | undefined,
  }));

  // Parse deploy_modes with new optional fields
  let deployModes: DeployMode[] | undefined;
  const rawModes = raw["deploy_modes"] as Array<Record<string, unknown>> | undefined;
  if (rawModes) {
    deployModes = rawModes.map((m) => ({
      id: m["id"] as string,
      label: m["label"] as string,
      phone_visible: m["phone_visible"] as boolean | undefined,
      objective: m["objective"] as string | undefined,
      agents: m["agents"] as string[] | undefined,
      skills: m["skills"] as string[] | undefined,
      mode_type: m["mode_type"] as DeployMode["mode_type"] | undefined,
      solo: m["solo"] as boolean | undefined,
      global_docs: m["global_docs"] as string[] | undefined,
    }));
  }

  // Parse hierarchy block
  let hierarchy: Hierarchy | undefined;
  const rawHierarchy = raw["hierarchy"] as Record<string, unknown> | undefined;
  if (rawHierarchy) {
    const parseMember = (m: Record<string, unknown>): HierarchyMember => ({
      role: m["role"] as string | undefined,
      participates_in: m["participates_in"] as HierarchyMember["participates_in"] | undefined,
    });

    const rawTm = rawHierarchy["team-manager"] as Record<string, unknown> | undefined;
    const rawAgents = rawHierarchy["agents"] as Array<Record<string, unknown>> | undefined;

    hierarchy = {
      ...(rawTm ? { "team-manager": parseMember(rawTm) } : {}),
      ...(rawAgents
        ? {
            agents: rawAgents.map((a) => ({
              name: a["name"] as string,
              ...parseMember(a),
            })),
          }
        : {}),
    };
  }

  return {
    name: raw["name"] as string,
    description: raw["description"] as string,
    context: raw["context"] as TeamConfig["context"],
    variables: raw["variables"] as Record<string, string> | undefined,
    agents,
    objective: raw["objective"] as string,
    model: raw["model"] as TeamConfig["model"] | undefined,
    ...(raw["default_mode"] ? { default_mode: raw["default_mode"] as string } : {}),
    ...(deployModes ? { deploy_modes: deployModes } : {}),
    ...(hierarchy ? { hierarchy } : {}),
    ...(raw["global_docs"] ? { global_docs: raw["global_docs"] as string[] } : {}),
  };
}
