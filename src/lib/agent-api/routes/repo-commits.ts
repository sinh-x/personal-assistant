/**
 * Repo commits routes — branch listing and commit history API.
 *
 * GET /api/repos/:key/branches — list all local branches with latest commit summary
 * GET /api/repos/:key/commits  — paginated commit history (query: branch, limit, offset)
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { loadRepoEntry } from "../../repos.js";

interface BranchSummary {
  name: string;
  is_current: boolean;
  latest_commit: {
    hash_short: string;
    message: string;
    date: string;
    author: string;
  };
}

interface DiffSummary {
  files_changed: number;
  insertions: number;
  deletions: number;
}

interface CommitEntry {
  hash: string;
  hash_short: string;
  author_name: string;
  author_email: string;
  date: string;
  message: string;
  diff_summary: DiffSummary;
}

/** Run a git command safely with 5s timeout, returning trimmed output or empty string on failure */
function gitRun(args: string[], cwd: string): string {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf-8", timeout: 5000 }).toString().trim();
  } catch {
    return "";
  }
}

/** Get all local branch names */
function getAllBranches(cwd: string): string[] {
  const output = gitRun(["branch", "--format", "%(refname:short)"], cwd);
  if (!output) return [];
  return output.split("\n").map((b) => b.trim()).filter((b) => b);
}

/** Get the currently checked-out branch name (empty string if detached HEAD) */
function getCurrentBranch(cwd: string): string {
  return gitRun(["branch", "--show-current"], cwd);
}

/** Get total commit count for a branch */
function getCommitCount(branch: string, cwd: string): number {
  const output = gitRun(["rev-list", "--count", branch], cwd);
  return parseInt(output, 10) || 0;
}

/**
 * Get latest commit info for a branch.
 * Format: hash_short | message | date | author
 */
function getLatestCommit(branch: string, cwd: string): BranchSummary["latest_commit"] | null {
  const output = gitRun([
    "log",
    "-1",
    "--format=%h%n%s%n%ci%n%an",
    branch,
  ], cwd);
  if (!output) return null;
  const lines = output.split("\n");
  if (lines.length < 4) return null;
  return {
    hash_short: lines[0],
    message: lines[1],
    date: lines[2],
    author: lines[3],
  };
}

/**
 * Get paginated commit history for a branch.
 * Returns commits with full hash, author info, date, message, and diff summary.
 */
function getCommitHistory(
  branch: string,
  limit: number,
  offset: number,
  cwd: string,
): CommitEntry[] {
  const commits: CommitEntry[] = [];

  // Get commit hashes first
  const hashOutput = gitRun([
    "log",
    branch,
    `--format=%H`,
    `-${limit}`,
    `--skip=${offset}`,
  ], cwd);

  if (!hashOutput) return commits;

  const hashes = hashOutput.split("\n").filter((h) => h);

  for (const hash of hashes) {
    // Get full commit info + numstat for this specific commit
    const logOutput = gitRun([
      "log",
      "-1",
      `--format=%H%n%h%n%an%n%ae%n%ci%n%s%n`,
      hash,
      "--numstat",
    ], cwd);

    if (!logOutput) {
      commits.push({
        hash,
        hash_short: hash.substring(0, 7),
        author_name: "unknown",
        author_email: "unknown",
        date: "",
        message: "",
        diff_summary: { files_changed: 0, insertions: 0, deletions: 0 },
      });
      continue;
    }

    const lines = logOutput.split("\n");
    if (lines.length < 6) {
      commits.push({
        hash,
        hash_short: hash.substring(0, 7),
        author_name: "unknown",
        author_email: "unknown",
        date: "",
        message: "",
        diff_summary: { files_changed: 0, insertions: 0, deletions: 0 },
      });
      continue;
    }

    const [fullHash, hashShort, authorName, authorEmail, date, ...rest] = lines;
    // rest contains: message line(s), blank line, then numstat lines

    // Find where numstat lines start (after blank line that separates message from numstat)
    const blankLineIndex = rest.findIndex((line, i) => i > 0 && line === "");
    const messageLines = blankLineIndex >= 0 ? rest.slice(0, blankLineIndex) : rest;
    const numstatLines = blankLineIndex >= 0 ? rest.slice(blankLineIndex + 1) : [];

    // Parse numstat lines
    let filesChanged = 0;
    let insertions = 0;
    let deletions = 0;
    for (const numLine of numstatLines) {
      if (!numLine) continue;
      const parts = numLine.split("\t");
      if (parts.length >= 3) {
        const added = parseInt(parts[0], 10) || 0;
        const removed = parseInt(parts[1], 10) || 0;
        if (added > 0 || removed > 0) {
          filesChanged++;
          insertions += added;
          deletions += removed;
        }
      }
    }

    commits.push({
      hash: fullHash,
      hash_short: hashShort,
      author_name: authorName,
      author_email: authorEmail,
      date,
      message: messageLines.join("\n"),
      diff_summary: { files_changed: filesChanged, insertions, deletions },
    });
  }

  return commits;
}

export function repoCommitsRoutes(): Hono {
  const app = new Hono();

  // Validation regexes (reused from repos.ts)
  const branchNameRegex = /^[a-zA-Z0-9._\-/]+$/;
  const repoKeyRegex = /^[a-zA-Z0-9-]+$/;

  // GET /api/repos/:key/branches — list all local branches with latest commit summary
  app.get("/api/repos/:key/branches", (c: Context) => {
    const key = c.req.param("key");
    if (!key) {
      return c.json({ error: "Repo key is required", code: "BAD_REQUEST" }, 400);
    }

    // F6: Validate repo key
    if (!repoKeyRegex.test(key)) {
      return c.json({ error: "Invalid repo key", code: "BAD_REQUEST" }, 400);
    }

    // Load repo entry
    const repoEntry = loadRepoEntry(key);
    if (!repoEntry) {
      return c.json({ error: `Repo key not found: ${key}`, code: "NOT_FOUND" }, 404);
    }

    const { name, path } = repoEntry;

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

    // Get all branches
    const branchNames = getAllBranches(path);
    const branches: BranchSummary[] = [];

    for (const branchName of branchNames) {
      const latestCommit = getLatestCommit(branchName, path);
      branches.push({
        name: branchName,
        is_current: branchName === currentBranch,
        latest_commit: latestCommit || {
          hash_short: "",
          message: "",
          date: "",
          author: "",
        },
      });
    }

    return c.json({
      repo: { key: name, path },
      branches,
    });
  });

  // GET /api/repos/:key/commits — paginated commit history
  app.get("/api/repos/:key/commits", (c: Context) => {
    const key = c.req.param("key");
    if (!key) {
      return c.json({ error: "Repo key is required", code: "BAD_REQUEST" }, 400);
    }

    // F6: Validate repo key
    if (!repoKeyRegex.test(key)) {
      return c.json({ error: "Invalid repo key", code: "BAD_REQUEST" }, 400);
    }

    // Load repo entry
    const repoEntry = loadRepoEntry(key);
    if (!repoEntry) {
      return c.json({ error: `Repo key not found: ${key}`, code: "NOT_FOUND" }, 404);
    }

    const { name, path } = repoEntry;

    // Check path exists
    if (!existsSync(path)) {
      return c.json({ error: `Repo path does not exist: ${path}`, code: "PATH_NOT_FOUND" }, 400);
    }

    // Check git repo
    const gitDir = join(path, ".git");
    if (!existsSync(gitDir)) {
      return c.json({ error: `Not a git repository: ${path}`, code: "NOT_GIT_REPO" }, 400);
    }

    // Get branch query param
    const branch = c.req.query("branch") || "HEAD";
    // F5: Validate branch name
    if (!branchNameRegex.test(branch)) {
      return c.json(
        { error: `Invalid branch name: ${branch}`, code: "BAD_REQUEST" },
        400,
      );
    }

    // Parse pagination params
    const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "50", 10), 1), 200);
    const offset = Math.max(parseInt(c.req.query("offset") || "0", 10), 0);

    // Get total commit count
    const total = getCommitCount(branch, path);

    // Get commits
    const commits = getCommitHistory(branch, limit, offset, path);

    return c.json({
      repo: { key: name, path },
      branch,
      commits,
      meta: {
        branch,
        total,
        limit,
        offset,
      },
    });
  });

  return app;
}
