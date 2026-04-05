import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import yaml from "js-yaml";
import { getHomeDir, getUserConfigPath } from "./paths.js";
import { loadConfig } from "./config.js";

export interface RepoEntry {
  path: string;
  description?: string;
  prefix?: string;
  developBranch?: string; // default: "develop", "none" to skip
  mainBranch?: string;   // default: "main"
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
        const e = entry as { path: string; description?: string; prefix?: string; developBranch?: string; mainBranch?: string };
        repos[name] = {
          path: expandHome(e.path),
          description: e.description,
          prefix: e.prefix,
          developBranch: e.developBranch,
          mainBranch: e.mainBranch,
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

/** Load repo entry without exiting on error (for API use) */
export function loadRepoEntry(key: string): { name: string; path: string; description?: string; prefix?: string; developBranch?: string; mainBranch?: string } | null {
  const repos = listRepos();
  const repo = repos.find((r) => r.name === key);
  if (!repo) return null;
  return { name: repo.name, path: repo.path, description: repo.description, prefix: repo.prefix, developBranch: repo.developBranch, mainBranch: repo.mainBranch };
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

/**
 * Resolve any project input (key, prefix, or path basename) to { key, prefix }.
 * Resolution order:
 *   (a) exact key match in repos.yaml
 *   (b) prefix match (case-insensitive)
 *   (c) path basename match
 * Throws a clear error listing valid keys for unknown input.
 */
export function resolveProject(input: string): { key: string; prefix: string } {
  const repos = loadReposYaml();

  // (a) Exact key match
  if (repos[input]?.prefix) {
    return { key: input, prefix: repos[input].prefix! };
  }

  // (b) Prefix match (case-insensitive)
  for (const [key, entry] of Object.entries(repos)) {
    if (entry.prefix && entry.prefix.toLowerCase() === input.toLowerCase()) {
      return { key, prefix: entry.prefix };
    }
  }

  // (c) Path basename match
  for (const [key, entry] of Object.entries(repos)) {
    if (entry.prefix && entry.path.endsWith(`/${input}`)) {
      return { key, prefix: entry.prefix };
    }
  }

  const validKeys = Object.keys(repos)
    .filter((k) => repos[k].prefix)
    .join(", ") || "(none)";
  throw new Error(`Unknown project "${input}". Valid project keys: ${validKeys}`);
}

/** Look up the ticket prefix for a project name from repos.yaml. */
export function getRepoPrefix(projectName: string): string | undefined {
  try {
    return resolveProject(projectName).prefix;
  } catch {
    return undefined;
  }
}

/**
 * Resolve the current working directory (CWD) to a project { key, prefix }.
 * Uses git rev-parse --show-toplevel to find the repo root, then matches
 * against listRepos() entries by path.
 * Returns undefined if not in a git repo or the repo is not in repos.yaml.
 */
export function resolveProjectFromCwd(): { key: string; prefix: string } | undefined {
  let repoRoot: string;
  try {
    repoRoot = execSync("git rev-parse --show-toplevel", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return undefined;
  }
  const repos = listRepos();
  for (const repo of repos) {
    if (repo.path === repoRoot && repo.prefix) {
      return { key: repo.name, prefix: repo.prefix };
    }
  }
  return undefined;
}
