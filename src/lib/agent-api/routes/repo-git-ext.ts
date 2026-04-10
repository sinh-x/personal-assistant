/**
 * Extended Git API routes — diff, remote branches, and branch comparison.
 *
 * GET /api/repos/:key/diff?commit=<sha>         — full commit diff with line-level changes
 * GET /api/repos/:key/branches/remote           — all remote tracking branches with latest commit
 * GET /api/repos/:key/compare?from=<branch>&to=<branch> — commits in to not in from
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { loadRepoEntry } from "../../repos.js";

// =============================================================================
// Types
// =============================================================================

interface DiffLine {
  type: "add" | "del" | "context";
  content: string;
}

interface DiffHunk {
  old_start: number;
  old_lines: number;
  new_start: number;
  new_lines: number;
  lines: DiffLine[];
}

interface DiffEntry {
  old_path: string;
  new_path: string;
  change_type: "added" | "modified" | "deleted" | "renamed";
  hunks: DiffHunk[];
  binary: boolean;
}

interface RemoteBranchEntry {
  name: string;
  tracking_local: string | null;
  latest_commit: {
    hash_short: string;
    message: string;
    date: string;
    author: string;
  };
}

interface CompareCommitEntry {
  hash: string;
  hash_short: string;
  author_name: string;
  author_email: string;
  date: string;
  message: string;
}

// =============================================================================
// Git Helpers
// =============================================================================

/** Run a git command safely with 5s timeout, returning trimmed output or empty string on failure */
function gitRun(args: string[], cwd: string): string {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf-8", timeout: 5000 }).toString().trim();
  } catch {
    return "";
  }
}

/** Validate that a SHA exists in the repo */
function shaExists(sha: string, cwd: string): boolean {
  const output = gitRun(["rev-parse", "--verify", "--quiet", sha], cwd);
  return output === sha;
}

// =============================================================================
// Diff Parsing
// =============================================================================

/**
 * Parse unified diff format from `git show <sha> -p --format="" --numstat`
 * Returns { diffEntries, filesChanged, insertions, deletions }
 */
function parseUnifiedDiff(diffOutput: string): {
  diffEntries: DiffEntry[];
  filesChanged: number;
  insertions: number;
  deletions: number;
} {
  const diffEntries: DiffEntry[] = [];
  let filesChanged = 0;
  let insertions = 0;
  let deletions = 0;

  // Split into file sections by lines starting with "diff --git"
  const fileSections = diffOutput.split(/^diff --git /m).filter((s) => s.trim());

  for (const section of fileSections) {
    const lines = section.split("\n");

    // Parse the "diff --git a/path b/path" header line
    const headerMatch = lines[0]?.match(/^a\/(.+?) b\/(.+?)(?:\s*$|$)/);
    if (!headerMatch) continue;

    const oldPath = headerMatch[1] || "";
    const newPath = headerMatch[2] || "";

    // Detect change type from subsequent lines
    let changeType: DiffEntry["change_type"] = "modified";
    let isBinary = false;
    const hunks: DiffHunk[] = [];

    // Parse the rest of the section
    let i = 1;
    while (i < lines.length) {
      const line = lines[i];

      // Check for binary file marker
      if (line.startsWith("Binary files")) {
        isBinary = true;
        i++;
        continue;
      }

      // New file (--git a/path b/path new file mode)
      if (line.includes("new file mode")) {
        changeType = "added";
        i++;
        continue;
      }

      // Deleted file
      if (line.includes("deleted file mode")) {
        changeType = "deleted";
        i++;
        continue;
      }

      // Renamed file
      if (line.includes("rename from")) {
        changeType = "renamed";
        i++;
        continue;
      }

      // Hunk header: @@ -old,count +new,count @@
      const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (hunkMatch) {
        const oldStart = parseInt(hunkMatch[1], 10);
        const oldLines = parseInt(hunkMatch[2] || "1", 10);
        const newStart = parseInt(hunkMatch[3], 10);
        const newLines = parseInt(hunkMatch[4] || "1", 10);

        const hunkLines: DiffLine[] = [];
        i++;

        // Read hunk lines until next hunk or end of section
        while (i < lines.length) {
          const hunkLine = lines[i];

          // Next hunk or new diff section
          if (hunkLine.startsWith("@@") || hunkLine.startsWith("diff --git")) {
            break;
          }

          if (hunkLine.startsWith("+") && !hunkLine.startsWith("+++")) {
            hunkLines.push({ type: "add", content: hunkLine.substring(1) });
            insertions++;
          } else if (hunkLine.startsWith("-") && !hunkLine.startsWith("---")) {
            hunkLines.push({ type: "del", content: hunkLine.substring(1) });
            deletions++;
          } else if (hunkLine.startsWith(" ") || hunkLine === "") {
            hunkLines.push({ type: "context", content: hunkLine.substring(1) || "" });
          } else if (hunkLine.startsWith("\\")) {
            // "\ No newline at end of file" — skip
          } else if (hunkLine.startsWith("+++")) {
            // skip
          }
          i++;
        }

        hunks.push({ old_start: oldStart, old_lines: oldLines, new_start: newStart, new_lines: newLines, lines: hunkLines });
        continue;
      }

      i++;
    }

    if (!isBinary) {
      filesChanged++;
    }

    diffEntries.push({
      old_path: oldPath,
      new_path: newPath,
      change_type: changeType,
      hunks,
      binary: isBinary,
    });
  }

  return { diffEntries, filesChanged, insertions, deletions };
}

/**
 * Get full commit diff using `git show <sha> -p --format="" --numstat`
 */
function getCommitDiff(repoPath: string, sha: string): {
  diffEntries: DiffEntry[];
  filesChanged: number;
  insertions: number;
  deletions: number;
} | null {
  const output = gitRun(["show", sha, "-m", "--first-parent", "-p", "--format=", "--numstat"], repoPath);
  if (!output) return null;
  return parseUnifiedDiff(output);
}

// =============================================================================
// Remote Branches
// =============================================================================

/**
 * Get all remote tracking branches with their latest commit info.
 */
function getRemoteBranches(repoPath: string): RemoteBranchEntry[] {
  // Get list of remote branches
  const branchOutput = gitRun(["branch", "-r", "--format", "%(refname:short)"], repoPath);
  if (!branchOutput) return [];

  const branchNames = branchOutput.split("\n").map((b) => b.trim()).filter((b) => b && !b.includes("HEAD"));

  const remoteBranches: RemoteBranchEntry[] = [];

  for (const branchName of branchNames) {
    // Get latest commit info for this branch
    const logOutput = gitRun([
      "log",
      "-1",
      "--format=%h%n%s%n%ci%n%an",
      branchName,
    ], repoPath);

    if (!logOutput) {
      remoteBranches.push({
        name: branchName,
        tracking_local: null,
        latest_commit: { hash_short: "", message: "", date: "", author: "" },
      });
      continue;
    }

    const logLines = logOutput.split("\n");
    remoteBranches.push({
      name: branchName,
      tracking_local: null, // Detached HEAD state for remote branches
      latest_commit: {
        hash_short: logLines[0] || "",
        message: logLines[1] || "",
        date: logLines[2] || "",
        author: logLines[3] || "",
      },
    });
  }

  return remoteBranches;
}

// =============================================================================
// Branch Comparison
// =============================================================================

/**
 * Get commits in `to` branch but not in `from` branch (git log from..to)
 */
function getBranchCompare(
  repoPath: string,
  from: string,
  to: string,
  limit: number,
  offset: number,
): { commits: CompareCommitEntry[]; total: number } {
  // Get total count first
  const countOutput = gitRun(["rev-list", "--count", `${from}..${to}`], repoPath);
  const total = parseInt(countOutput, 10) || 0;

  // Get commit hashes (with pagination)
  const hashOutput = gitRun([
    "log",
    `${from}..${to}`,
    "--format=%H",
    `-${limit}`,
    `--skip=${offset}`,
  ], repoPath);

  if (!hashOutput) return { commits: [], total };

  const hashes = hashOutput.split("\n").filter((h) => h);
  const commits: CompareCommitEntry[] = [];

  for (const hash of hashes) {
    const logOutput = gitRun([
      "log",
      "-1",
      "--format=%H%n%h%n%an%n%ae%n%ci%n%s",
      hash,
    ], repoPath);

    if (!logOutput) {
      commits.push({
        hash,
        hash_short: hash.substring(0, 7),
        author_name: "unknown",
        author_email: "unknown",
        date: "",
        message: "",
      });
      continue;
    }

    const logLines = logOutput.split("\n");
    commits.push({
      hash: logLines[0] || hash,
      hash_short: logLines[1] || hash.substring(0, 7),
      author_name: logLines[2] || "unknown",
      author_email: logLines[3] || "unknown",
      date: logLines[4] || "",
      message: logLines[5] || "",
    });
  }

  return { commits, total };
}

// =============================================================================
// Route Factory
// =============================================================================

export function repoGitExtRoutes(): Hono {
  const app = new Hono();

  // Validation regexes (reused from repo-commits.ts)
  const branchNameRegex = /^[a-zA-Z0-9._\-/]+$/;
  const repoKeyRegex = /^[a-zA-Z0-9-]+$/;
  const shaRegex = /^[a-f0-9]{40}$/i;

  // ---------------------------------------------------------------------------
  // GET /api/repos/:key/diff?commit=<sha> — full commit diff
  // ---------------------------------------------------------------------------
  app.get("/api/repos/:key/diff", (c: Context) => {
    const key = c.req.param("key");
    const sha = c.req.query("commit");

    // Validate repo key
    if (!key) {
      return c.json({ error: "Repo key is required", code: "BAD_REQUEST" }, 400);
    }
    if (!repoKeyRegex.test(key)) {
      return c.json({ error: "Invalid repo key", code: "BAD_REQUEST" }, 400);
    }

    // Validate SHA
    if (!sha) {
      return c.json({ error: "commit query param is required", code: "BAD_REQUEST" }, 400);
    }
    if (!shaRegex.test(sha)) {
      return c.json({ error: "Invalid SHA format. Must be 40-character hex string", code: "BAD_REQUEST" }, 400);
    }

    // Load repo
    const repoEntry = loadRepoEntry(key);
    if (!repoEntry) {
      return c.json({ error: `Repo key not found: ${key}`, code: "NOT_FOUND" }, 404);
    }

    const { name, path } = repoEntry;

    if (!existsSync(path)) {
      return c.json({ error: `Repo path does not exist: ${path}`, code: "PATH_NOT_FOUND" }, 400);
    }

    const gitDir = join(path, ".git");
    if (!existsSync(gitDir)) {
      return c.json({ error: `Not a git repository: ${path}`, code: "NOT_GIT_REPO" }, 400);
    }

    // Verify SHA exists
    if (!shaExists(sha, path)) {
      return c.json({ error: `Commit SHA not found: ${sha}`, code: "NOT_FOUND" }, 404);
    }

    // Get diff
    const diffResult = getCommitDiff(path, sha);
    if (!diffResult) {
      return c.json({ error: "Could not generate diff", code: "DIFF_FAILED" }, 500);
    }

    return c.json({
      repo: { key: name, path },
      commit: sha,
      diff_entries: diffResult.diffEntries,
      meta: {
        commit: sha,
        files_changed: diffResult.filesChanged,
        insertions: diffResult.insertions,
        deletions: diffResult.deletions,
      },
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/repos/:key/branches/remote — all remote tracking branches
  // ---------------------------------------------------------------------------
  app.get("/api/repos/:key/branches/remote", (c: Context) => {
    const key = c.req.param("key");

    // Validate repo key
    if (!key) {
      return c.json({ error: "Repo key is required", code: "BAD_REQUEST" }, 400);
    }
    if (!repoKeyRegex.test(key)) {
      return c.json({ error: "Invalid repo key", code: "BAD_REQUEST" }, 400);
    }

    // Load repo
    const repoEntry = loadRepoEntry(key);
    if (!repoEntry) {
      return c.json({ error: `Repo key not found: ${key}`, code: "NOT_FOUND" }, 404);
    }

    const { name, path } = repoEntry;

    if (!existsSync(path)) {
      return c.json({ error: `Repo path does not exist: ${path}`, code: "PATH_NOT_FOUND" }, 400);
    }

    const gitDir = join(path, ".git");
    if (!existsSync(gitDir)) {
      return c.json({ error: `Not a git repository: ${path}`, code: "NOT_GIT_REPO" }, 400);
    }

    const remoteBranches = getRemoteBranches(path);

    return c.json({
      repo: { key: name, path },
      remote_branches: remoteBranches,
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/repos/:key/compare?from=<branch>&to=<branch> — branch comparison
  // ---------------------------------------------------------------------------
  app.get("/api/repos/:key/compare", (c: Context) => {
    const key = c.req.param("key");
    const from = c.req.query("from");
    const to = c.req.query("to");

    // Validate repo key
    if (!key) {
      return c.json({ error: "Repo key is required", code: "BAD_REQUEST" }, 400);
    }
    if (!repoKeyRegex.test(key)) {
      return c.json({ error: "Invalid repo key", code: "BAD_REQUEST" }, 400);
    }

    // Validate from/to params
    if (!from) {
      return c.json({ error: "from query param is required", code: "BAD_REQUEST" }, 400);
    }
    if (!to) {
      return c.json({ error: "to query param is required", code: "BAD_REQUEST" }, 400);
    }

    // Validate branch names
    if (!branchNameRegex.test(from)) {
      return c.json({ error: `Invalid branch name: ${from}`, code: "BAD_REQUEST" }, 400);
    }
    if (!branchNameRegex.test(to)) {
      return c.json({ error: `Invalid branch name: ${to}`, code: "BAD_REQUEST" }, 400);
    }

    // Load repo
    const repoEntry = loadRepoEntry(key);
    if (!repoEntry) {
      return c.json({ error: `Repo key not found: ${key}`, code: "NOT_FOUND" }, 404);
    }

    const { name, path } = repoEntry;

    if (!existsSync(path)) {
      return c.json({ error: `Repo path does not exist: ${path}`, code: "PATH_NOT_FOUND" }, 400);
    }

    const gitDir = join(path, ".git");
    if (!existsSync(gitDir)) {
      return c.json({ error: `Not a git repository: ${path}`, code: "NOT_GIT_REPO" }, 400);
    }

    // Parse pagination params
    const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "50", 10), 1), 200);
    const offset = Math.max(parseInt(c.req.query("offset") || "0", 10), 0);

    const { commits, total } = getBranchCompare(path, from, to, limit, offset);

    return c.json({
      repo: { key: name, path },
      from,
      to,
      commits,
      meta: {
        from,
        to,
        total,
        limit,
        offset,
      },
    });
  });

  return app;
}
