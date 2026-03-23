/**
 * Teams routes — agent teams and PA teams/repos.
 *
 * GET /api/teams     — list agent teams from ~/Documents/ai-usage/agent-teams/
 * GET /api/pa-teams  — list PA teams from the repo's teams/ directory
 * GET /api/pa-repos  — list repos from repos.yaml
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { getAgentTeamsDir, getBuiltinTeamsDir, getConfigDir } from "../../paths.js";
import { parseTeamYaml } from "../../yaml-parser.js";
import { listRepos } from "../../repos.js";

const AI_USAGE = join(homedir(), "Documents", "ai-usage");

function countFiles(dir: string): number {
  if (!existsSync(dir)) return 0;
  try {
    return readdirSync(dir).filter((f) => {
      try {
        return statSync(join(dir, f)).isFile();
      } catch {
        return false;
      }
    }).length;
  } catch {
    return 0;
  }
}

export function teamsRoutes(): Hono {
  const app = new Hono();

  // GET /api/teams — list agent teams with folder counts
  app.get("/api/teams", (c: Context) => {
    const teamsDir = getAgentTeamsDir();
    if (!existsSync(teamsDir)) {
      return c.json({ teams: [] });
    }

    const teams: Record<string, unknown>[] = [];
    for (const name of readdirSync(teamsDir)) {
      if (name.startsWith(".")) continue;
      const teamPath = join(teamsDir, name);
      try {
        if (!statSync(teamPath).isDirectory()) continue;
      } catch {
        continue;
      }

      const folders: string[] = [];
      try {
        for (const sub of readdirSync(teamPath)) {
          const subPath = join(teamPath, sub);
          try {
            if (statSync(subPath).isDirectory()) folders.push(sub);
          } catch {
            // skip
          }
        }
      } catch {
        // skip unreadable dirs
      }

      teams.push({
        name,
        folders,
        inbox_count: countFiles(join(teamPath, "inbox")),
        ongoing_count: countFiles(join(teamPath, "ongoing")),
        wfr_count: countFiles(join(teamPath, "waiting-for-response")),
      });
    }

    teams.sort((a, b) => (a["name"] as string).localeCompare(b["name"] as string));
    return c.json({ teams });
  });

  // GET /api/pa-teams — list PA teams with deploy modes
  app.get("/api/pa-teams", (c: Context) => {
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
            .filter((m) => m.phone_visible !== false)
            .map((m) => ({
              id: m.id,
              label: m.label,
              phone_visible: m.phone_visible,
              mode_type: m.mode_type,
            }));

          teams.push({
            name: config.name,
            description: config.description ?? "",
            deploy_modes: modes,
          });
        } catch {
          // skip malformed YAML
        }
      }
    }

    teams.sort((a, b) => (a["name"] as string).localeCompare(b["name"] as string));
    return c.json({ teams });
  });

  // GET /api/pa-repos — list repos from repos.yaml
  app.get("/api/pa-repos", (c: Context) => {
    try {
      const repos = listRepos().map((r) => ({
        name: r.name,
        path: r.path,
        description: r.description,
        prefix: r.prefix,
      }));
      return c.json({ repos });
    } catch {
      return c.json({ repos: [] });
    }
  });

  // GET /api/agent-teams — list agent team names (slim list)
  app.get("/api/agent-teams", (c: Context) => {
    const teamsDir = join(AI_USAGE, "agent-teams");
    if (!existsSync(teamsDir)) {
      return c.json({ teams: [] });
    }

    const teams: Record<string, unknown>[] = [];
    for (const name of readdirSync(teamsDir)) {
      if (name.startsWith(".")) continue;
      const teamPath = join(teamsDir, name);
      try {
        if (!statSync(teamPath).isDirectory()) continue;
      } catch {
        continue;
      }
      const inboxExists = existsSync(join(teamPath, "inbox"));
      teams.push({ name, inbox_exists: inboxExists });
    }

    teams.sort((a, b) => (a["name"] as string).localeCompare(b["name"] as string));
    return c.json({ teams });
  });

  return app;
}
