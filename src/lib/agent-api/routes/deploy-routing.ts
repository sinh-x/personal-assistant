/**
 * Deploy routing route — returns teams and repos for routing a deployment.
 *
 * GET /api/deploy-routing
 *   Returns: {
 *     teams: [{name, description, modes: [{id, label, modeType}]}],
 *     repos: [{name, path, description}]
 *   }
 *   Filters out interactive-mode-only teams and individual interactive modes.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getBuiltinTeamsDir, getConfigDir } from "../../paths.js";
import { parseTeamYaml } from "../../yaml-parser.js";
import { listRepos } from "../../repos.js";

export function deployRoutingRoutes(): Hono {
  const app = new Hono();

  // GET /api/deploy-routing — teams (non-interactive modes) + repos
  app.get("/api/deploy-routing", (c: Context) => {
    const seenNames = new Set<string>();
    const teams: Record<string, unknown>[] = [];

    const dirsTried: string[] = [];
    const configDir = getConfigDir();
    if (configDir) {
      dirsTried.push(join(configDir, "teams"));
    }
    dirsTried.push(getBuiltinTeamsDir());

    for (const dir of dirsTried) {
      if (!existsSync(dir)) continue;
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        continue;
      }

      for (const filename of entries) {
        if (!filename.endsWith(".yaml")) continue;
        if (filename === "example.yaml") continue;

        const filePath = join(dir, filename);
        try {
          const config = parseTeamYaml(filePath);
          if (!config.name || seenNames.has(config.name)) continue;
          seenNames.add(config.name);

          const modes = (config.deploy_modes ?? [])
            .filter((m) => m.mode_type !== "interactive")
            .map((m) => ({
              id: m.id,
              label: m.label,
              modeType: m.mode_type ?? null,
            }));

          // Skip teams with no non-interactive modes
          if (modes.length === 0) continue;

          teams.push({
            name: config.name,
            description: config.description ?? "",
            modes,
          });
        } catch {
          // skip malformed YAML
        }
      }
    }

    teams.sort((a, b) => (a["name"] as string).localeCompare(b["name"] as string));

    let repos: Record<string, unknown>[];
    try {
      repos = listRepos().map((r) => ({
        name: r.name,
        path: r.path,
        description: r.description,
      }));
    } catch {
      repos = [];
    }

    return c.json({ teams, repos });
  });

  return app;
}
