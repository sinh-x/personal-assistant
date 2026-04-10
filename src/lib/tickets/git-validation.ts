import { execSync } from "node:child_process";
import { loadRepoEntry, listRepos } from "../repos.js";
import type { AddLinkedBranchInput, AddLinkedCommitInput, LinkedBranch, LinkedCommit } from "./types.js";

/** Get list of valid repo keys for error messages */
function getValidRepoKeys(): string[] {
  return listRepos().map((r: { name: string }) => r.name).sort();
}

/**
 * Validate repo key exists in repos.yaml.
 * Throws with clear error if not found.
 */
function validateRepoKey(repo: string): { name: string; path: string } {
  const entry = loadRepoEntry(repo);
  if (!entry) {
    const valid = getValidRepoKeys();
    throw new Error(
      `Unknown repo "${repo}". Valid repos: ${valid.join(", ") || "(none)"}`
    );
  }
  return { name: entry.name, path: entry.path };
}

/**
 * Check if a path is a valid git repository.
 */
function isGitRepo(path: string): boolean {
  try {
    execSync("git rev-parse --git-dir", { cwd: path, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve and validate a linked branch.
 * - Validates repo key against repos.yaml
 * - Verifies repo path is a git repo
 * - Validates branch exists locally via git rev-parse
 * - Auto-resolves SHA from branch HEAD
 *
 * Returns a fully-populated LinkedBranch ready for storage.
 */
export function resolveLinkedBranch(
  input: AddLinkedBranchInput,
  actor: string
): LinkedBranch {
  // Step 1: Validate repo key
  const repoEntry = validateRepoKey(input.repo);

  // Step 2: Verify it's a git repo
  if (!isGitRepo(repoEntry.path)) {
    throw new Error(`Path is not a git repository: ${repoEntry.path}`);
  }

  // Step 3: Validate branch exists and resolve SHA
  let sha: string;
  try {
    sha = execSync("git rev-parse --verify refs/heads/" + input.branch, {
      cwd: repoEntry.path,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    throw new Error(
      `Branch "${input.branch}" not found in repo "${input.repo}". ` +
        `Hint: local branches only. Run "git fetch" first if the branch exists on a remote.`
    );
  }

  return {
    repo: input.repo,
    branch: input.branch,
    sha,
    linkedAt: new Date().toISOString(),
    linkedBy: input.linkedBy ?? actor,
  };
}

/**
 * Resolve and validate a linked commit.
 * - Validates repo key against repos.yaml
 * - Verifies repo path is a git repo
 * - Validates commit SHA exists via git cat-file -t
 * - Auto-resolves message, author, timestamp from git log
 *
 * Returns a fully-populated LinkedCommit ready for storage.
 */
export function resolveLinkedCommit(
  input: AddLinkedCommitInput,
  actor: string
): LinkedCommit {
  // Step 1: Validate repo key
  const repoEntry = validateRepoKey(input.repo);

  // Step 2: Verify it's a git repo
  if (!isGitRepo(repoEntry.path)) {
    throw new Error(`Path is not a git repository: ${repoEntry.path}`);
  }

  // Step 3: Validate commit exists
  try {
    const type = execSync(`git cat-file -t ${input.sha}`, {
      cwd: repoEntry.path,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (type !== "commit") {
      throw new Error(`Object "${input.sha}" is not a commit (type: ${type})`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not a commit")) {
      throw new Error(
        `Commit "${input.sha}" not found in repo "${input.repo}". ` + `Hint: make sure the commit exists locally.`,
        { cause: err }
      );
    }
    throw new Error(`Commit "${input.sha}" not found in repo "${input.repo}"`, { cause: err });
  }

  // Step 4: Auto-resolve metadata
  let message = input.message ?? "";
  let author = input.author ?? "";
  let timestamp = input.timestamp ?? "";

  if (!message || !author || !timestamp) {
    const logLine = execSync("git log -1 --format='%s|%an|%aI' " + input.sha, {
      cwd: repoEntry.path,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const [logMsg, logAuthor, logTimestamp] = logLine.split("|");
    if (!message) message = logMsg;
    if (!author) author = logAuthor;
    if (!timestamp) timestamp = logTimestamp;
  }

  return {
    repo: input.repo,
    sha: input.sha,
    message,
    author,
    timestamp,
    linkedAt: new Date().toISOString(),
    linkedBy: input.linkedBy ?? actor,
  };
}
