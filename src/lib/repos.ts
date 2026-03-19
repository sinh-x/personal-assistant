import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";
import yaml from "js-yaml";
import { getHomeDir, getUserConfigPath } from "./paths.js";
import { loadConfig } from "./config.js";

export interface RepoEntry {
  path: string;
  description?: string;
}

/** Expand ~ to home directory */
function expandHome(p: string): string {
  if (p.startsWith("~")) {
    return resolve(homedir(), p.slice(2));
  }
  return p;
}

/** Load repos.yaml, searching config dir → user config dir → PA_HOME */
function loadReposYaml(): Record<string, RepoEntry> {
  const config = loadConfig();
  const paHome = getHomeDir();
  const userConfigDir = dirname(getUserConfigPath());

  const searchPaths: string[] = [];
  if (config.configDir) {
    searchPaths.push(resolve(config.configDir, "repos.yaml"));
  }
  searchPaths.push(resolve(userConfigDir, "repos.yaml"));
  searchPaths.push(resolve(paHome, "repos.yaml"));

  for (const p of searchPaths) {
    if (existsSync(p)) {
      const content = readFileSync(p, "utf-8");
      const raw = yaml.load(content) as { repos?: Record<string, unknown> };
      const repos: Record<string, RepoEntry> = {};
      for (const [name, entry] of Object.entries(raw.repos ?? {})) {
        const e = entry as { path: string; description?: string };
        repos[name] = {
          path: expandHome(e.path),
          description: e.description,
        };
      }
      return repos;
    }
  }

  return {};
}

/** List all repos with resolved paths */
export function listRepos(): Array<{ name: string } & RepoEntry> {
  const repos = loadReposYaml();
  return Object.entries(repos).map(([name, entry]) => ({ name, ...entry }));
}

/** Resolve a repo name to its entry (with expanded path). Exits on error. */
export function resolveRepo(name: string): { name: string } & RepoEntry {
  const repos = loadReposYaml();
  const entry = repos[name];
  if (!entry) {
    const available = Object.keys(repos).join(", ") || "(none)";
    console.error(`Error: Unknown repo: ${name}`);
    console.error(`  Available repos: ${available}`);
    process.exit(1);
  }
  if (!existsSync(entry.path)) {
    console.error(`Error: Repo path does not exist: ${entry.path} (repo: ${name})`);
    process.exit(1);
  }
  return { name, ...entry };
}
