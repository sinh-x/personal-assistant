/**
 * Repos routes — git info API for repos defined in repos.yaml.
 *
 * GET /api/repos/git-summary — lightweight summary across all repos
 * GET /api/repos/:key/git-info  — detailed git info for a single repo
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { listRepos, loadRepoEntry } from "../../repos.js";

interface BranchInfo {
  name: string;
  exists: boolean;
  latestCommit?: {
    hash: string;
    message: string;
    date: string;
  };
}

interface FeatureBranch {
  name: string;
  latestCommit: {
    hash_short: string;
    message: string;
    date: string;
  };
}

interface WorkingDirectory {
  clean: boolean;
  uncommitted_count: number;
}

interface GitInfoErrors {
  main?: string;
  develop?: string;
  featureBranches?: string;
  workingDirectory?: string;
}

/** Run a git command safely, returning trimmed output or empty string on failure */
function gitRun(args: string[], cwd: string): string {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf-8", timeout: 5000 }).toString().trim();
  } catch {
    return "";
  }
}

/** Check if a branch exists locally */
function branchExists(branchName: string, cwd: string): boolean {
  const output = gitRun(["rev-parse", "--verify", `--quiet`, branchName], cwd);
  return output !== "";
}

/** Get current checked-out branch name */
function getCurrentBranch(cwd: string): string {
  const output = gitRun(["branch", "--show-current"], cwd);
  return output || gitRun(["rev-parse", "--abbrev-ref", "HEAD"], cwd) || "";
}

/** Get the latest commit info for a branch (hash, message, date) */
function getBranchInfo(branchName: string, cwd: string): BranchInfo {
  if (!branchExists(branchName, cwd)) {
    return { name: branchName, exists: false };
  }

  // Use newline-separated format to avoid JSON parsing issues with special chars
  const logOutput = gitRun([
    "log",
    "-1",
    "--format=%H%n%s%n%ci",
    branchName,
  ], cwd);

  if (logOutput) {
    const lines = logOutput.split("\n");
    if (lines.length >= 3) {
      return {
        name: branchName,
        exists: true,
        latestCommit: {
          hash: lines[0],
          message: lines[1],
          date: lines[2],
        },
      };
    }
  }

  return {
    name: branchName,
    exists: true,
    latestCommit: undefined,
  };
}

/** Get ahead/behind count between two branches */
function getAheadBehind(base: string, compare: string, cwd: string): { main_ahead: number; develop_ahead: number; diverged: boolean } {
  // main_ahead = commits in base NOT in compare
  // develop_ahead = commits in compare NOT in base
  const mainAhead = Number(gitRun(["rev-list", "--count", `${compare}..${base}`], cwd) || "0");
  const developAhead = Number(gitRun(["rev-list", "--count", `${base}..${compare}`], cwd) || "0");
  return {
    main_ahead: mainAhead,
    develop_ahead: developAhead,
    diverged: mainAhead > 0 && developAhead > 0,
  };
}

/** Get list of feature branches not merged to develop */
function getUnmergedBranches(developBranch: string, cwd: string): FeatureBranch[] {
  if (!branchExists(developBranch, cwd)) {
    return [];
  }

  // Get all local branches not merged to develop
  const output = gitRun(["branch", "--no-merged", developBranch], cwd);
  if (!output) return [];

  const branchNames = output.split("\n").map((b) => b.trim()).filter((b) => b && !b.startsWith("*"));

  const features: FeatureBranch[] = [];
  for (const name of branchNames) {
    // Skip main and develop branches
    if (name === "main" || name === "develop" || name === "master") continue;

    // F5: Filter out squash-merged branches
    // git cherry returns patches that are different between two branches
    // If output is empty or all lines start with "-", branch was squash-merged
    const cherryOutput = gitRun(["cherry", developBranch, name], cwd);
    if (cherryOutput) {
      const cherryLines = cherryOutput.split("\n").filter((l) => l.trim());
      const allMinus = cherryLines.length > 0 && cherryLines.every((l) => l.startsWith("-"));
      if (allMinus) {
        // Branch was squash-merged, skip it
        continue;
      }
    }

    // Use newline-separated format to avoid JSON parsing issues
    const logOutput = gitRun([
      "log",
      "-1",
      "--format=%h%n%s%n%ci",
      name,
    ], cwd);

    if (logOutput) {
      const lines = logOutput.split("\n");
      if (lines.length >= 3) {
        features.push({
          name,
          latestCommit: {
            hash_short: lines[0],
            message: lines[1],
            date: lines[2],
          },
        });
      } else {
        features.push({
          name,
          latestCommit: { hash_short: "?", message: "?", date: "?" },
        });
      }
    }
  }

  return features;
}

/** Get working directory status (clean/dirty, uncommitted count) */
function getWorkingDirStatus(cwd: string): WorkingDirectory {
  const statusOutput = gitRun(["status", "--porcelain"], cwd);
  if (!statusOutput) {
    return { clean: true, uncommitted_count: 0 };
  }

  const lines = statusOutput.split("\n").filter((l) => l.trim());
  return {
    clean: lines.length === 0,
    uncommitted_count: lines.length,
  };
}

export function reposRoutes(): Hono {
  const app = new Hono();

  // GET /api/repos/git-summary — lightweight summary across all repos
  app.get("/api/repos/git-summary", (c: Context) => {
    const repos = listRepos();
    const summaryRepos: Array<{
      key: string;
      path: string;
      prefix?: string;
      current_branch: string;
      is_dirty: boolean;
      feature_branch_count: number;
      develop_ahead_of_main: number;
      error?: string;
    }> = [];

    for (const repo of repos) {
      let error: string | undefined;
      let currentBranch = "";
      let isDirty = false;
      let featureBranchCount = 0;
      let developAheadOfMain = 0;

      try {
        if (!existsSync(repo.path)) {
          error = "Repo path does not exist on disk";
        } else {
          // Check if it's a git repo
          const gitDir = join(repo.path, ".git");
          if (!existsSync(gitDir)) {
            error = "Not a git repository";
          } else {
            currentBranch = getCurrentBranch(repo.path);
            isDirty = !getWorkingDirStatus(repo.path).clean;
            const repoMainBranch = repo.mainBranch || "main";
            const repoDevelopBranch = repo.developBranch === "none" ? null : (repo.developBranch || "develop");
            const features = repoDevelopBranch ? getUnmergedBranches(repoDevelopBranch, repo.path) : [];
            featureBranchCount = features.length;

            // Calculate develop ahead of main
            const mainExists = branchExists(repoMainBranch, repo.path);
            const developExists = !!repoDevelopBranch && branchExists(repoDevelopBranch, repo.path);
            if (mainExists && developExists) {
              const aheadBehind = getAheadBehind(repoMainBranch, repoDevelopBranch, repo.path);
              developAheadOfMain = aheadBehind.develop_ahead;
            }
          }
        }
      } catch (e) {
        error = e instanceof Error ? e.message : "Unknown error";
      }

      summaryRepos.push({
        key: repo.name,
        path: repo.path,
        prefix: repo.prefix,
        current_branch: currentBranch,
        is_dirty: isDirty,
        feature_branch_count: featureBranchCount,
        develop_ahead_of_main: developAheadOfMain,
        error,
      });
    }

    return c.json({ repos: summaryRepos });
  });

  // GET /api/repos/:key/git-info — detailed git info for a single repo
  app.get("/api/repos/:key/git-info", (c: Context) => {
    const key = c.req.param("key");
    if (!key) {
      return c.json({ error: "Repo key is required", code: "BAD_REQUEST" }, 400);
    }

    // F7: Validate key with same regex as repo-deployments.ts
    if (!/^[a-zA-Z0-9-]+$/.test(key)) {
      return c.json({ error: "Invalid repo key", code: "BAD_REQUEST" }, 400);
    }

    // Load repo entry
    const repoEntry = loadRepoEntry(key);
    if (!repoEntry) {
      return c.json({ error: `Repo key not found: ${key}`, code: "NOT_FOUND" }, 404);
    }

    const mainBranch = c.req.query("main") || repoEntry.mainBranch || "main";
    const configuredDevelop = c.req.query("develop") || repoEntry.developBranch || "develop";
    const skipDevelopChecks = configuredDevelop === "none";
    const developBranch = skipDevelopChecks ? "none" : configuredDevelop;

    // F2: Validate branch name params - only allow alphanumeric, dots, underscores, hyphens, and forward slashes
    const branchNameRegex = /^[a-zA-Z0-9._\-\/]+$/;
    if (!branchNameRegex.test(mainBranch)) {
      return c.json({ error: `Invalid main branch name: ${mainBranch}`, code: "BAD_REQUEST" }, 400);
    }
    if (!skipDevelopChecks && !branchNameRegex.test(developBranch)) {
      return c.json({ error: `Invalid develop branch name: ${developBranch}`, code: "BAD_REQUEST" }, 400);
    }

    const { name, path, description, prefix } = repoEntry;
    const errors: GitInfoErrors = {};

    // Check path exists
    if (!existsSync(path)) {
      return c.json({ error: `Repo path does not exist: ${path}`, code: "PATH_NOT_FOUND" }, 400);
    }

    // Check git repo
    const gitDir = join(path, ".git");
    if (!existsSync(gitDir)) {
      return c.json({ error: `Not a git repository: ${path}`, code: "NOT_GIT_REPO" }, 400);
    }

    // Get current branch
    const currentBranch = getCurrentBranch(path);

    // Get main branch info
    let mainBranchInfo: BranchInfo;
    if (!branchExists(mainBranch, path)) {
      errors.main = `Branch '${mainBranch}' not found`;
      mainBranchInfo = { name: mainBranch, exists: false };
    } else {
      mainBranchInfo = getBranchInfo(mainBranch, path);
    }

    // Get develop branch info (skip if developBranch === "none")
    let developBranchInfo: BranchInfo;
    if (skipDevelopChecks) {
      developBranchInfo = { name: "none", exists: false };
    } else if (!branchExists(developBranch, path)) {
      errors.develop = `Branch '${developBranch}' not found`;
      developBranchInfo = { name: developBranch, exists: false };
    } else {
      developBranchInfo = getBranchInfo(developBranch, path);
    }

    // Get ahead/behind between main and develop (skip if developBranch === "none")
    let mainVsDevelop: { main_ahead: number; develop_ahead: number; diverged: boolean };
    if (skipDevelopChecks || !mainBranchInfo.exists || !developBranchInfo.exists) {
      mainVsDevelop = { main_ahead: 0, develop_ahead: 0, diverged: false };
    } else {
      mainVsDevelop = getAheadBehind(mainBranch, developBranch, path);
    }

    // Get feature branches not merged to develop (skip if developBranch === "none")
    let featureBranches: FeatureBranch[];
    if (skipDevelopChecks) {
      featureBranches = [];
    } else {
      try {
        featureBranches = getUnmergedBranches(developBranch, path);
      } catch (e) {
        errors.featureBranches = e instanceof Error ? e.message : "Failed to get feature branches";
        featureBranches = [];
      }
    }

    // Get working directory status
    let workingDirectory: WorkingDirectory;
    try {
      workingDirectory = getWorkingDirStatus(path);
    } catch (e) {
      errors.workingDirectory = e instanceof Error ? e.message : "Failed to get working directory status";
      workingDirectory = { clean: false, uncommitted_count: 0 };
    }

    const response = {
      repo: { key: name, path, description, prefix },
      current_branch: currentBranch,
      main_branch: mainBranchInfo,
      develop_branch: developBranchInfo,
      main_vs_develop: mainVsDevelop,
      feature_branches: featureBranches,
      working_directory: workingDirectory,
      errors: Object.keys(errors).length > 0 ? errors : undefined,
    };

    return c.json(response);
  });

  return app;
}
