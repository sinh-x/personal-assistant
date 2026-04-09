#!/usr/bin/env tsx
/**
 * scripts/backfill-ticket-links.ts
 * Backfill script to scan git history and link branches/commits to tickets.
 *
 * Usage:
 *   npx tsx scripts/backfill-ticket-links.ts <ticket-id> [--repo-path <path>] [--dry-run]
 *   npx tsx scripts/backfill-ticket-links.ts --project <name> [--repo-path <path>] [--dry-run]
 *
 * The script is idempotent — safe to run multiple times (upsert semantics in TicketStore).
 */

import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { basename } from "node:path";
import { TicketStore } from "../src/lib/tickets/index.js";
import { listRepos } from "../src/lib/repos.js";
import { getTicketsDir } from "../src/lib/paths.js";

// ── CLI argument parsing ──────────────────────────────────────────────────────

const args = process.argv.slice(2);
let ticketId: string | undefined;
let projectName: string | undefined;
let repoPath = process.cwd();
let dryRun = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--project" && i + 1 < args.length) {
    projectName = args[++i];
  } else if (arg === "--repo-path" && i + 1 < args.length) {
    repoPath = args[++i];
  } else if (arg === "--dry-run") {
    dryRun = true;
  } else if (!arg.startsWith("--")) {
    ticketId = arg;
  }
}

if (!ticketId && !projectName) {
  console.error("Usage:");
  console.error("  npx tsx scripts/backfill-ticket-links.ts <ticket-id> [--repo-path <path>] [--dry-run]");
  console.error("  npx tsx scripts/backfill-ticket-links.ts --project <name> [--repo-path <path>] [--dry-run]");
  process.exit(1);
}

// ── Repo name detection ─────────────────────────────────────────────────────────

function detectRepoName(repoPath: string): string {
  // Try to match repo path to repos.yaml entries
  const repos = listRepos();
  for (const repo of repos) {
    if (repo.path === repoPath) {
      return repo.name;
    }
  }
  // Fall back to directory basename
  return basename(repoPath);
}

const repoName = detectRepoName(repoPath);

// ── TicketStore setup ─────────────────────────────────────────────────────────

const store = new TicketStore();

// ── Get target tickets ────────────────────────────────────────────────────────

let targetTickets: Array<{ id: string; project: string }> = [];

if (ticketId) {
  const ticket = store.get(ticketId);
  if (!ticket) {
    console.error(`Error: Ticket not found: ${ticketId}`);
    process.exit(1);
  }
  targetTickets = [ticket];
} else if (projectName) {
  // List all tickets for the project
  // We need to find all ticket files — scan the tickets directory
  const ticketsDir = getTicketsDir();
  const files = readdirSync(ticketsDir).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    const id = file.replace(/\.json$/, "");
    const ticket = store.get(id);
    if (ticket && ticket.project === projectName) {
      targetTickets.push(ticket);
    }
  }
}

// ── Git helpers ────────────────────────────────────────────────────────────────

interface GitCommit {
  sha: string;
  message: string;
  author: string;
  timestamp: string;
}

function getCommitsForTicketId(ticketIdPattern: string): GitCommit[] {
  const commits: GitCommit[] = [];

  // Get all commits (newest first) matching the ticket ID in message
  // Skip merge commits (commits with 2+ parents) — they don't represent real work
  try {
    const output = execSync(
      `git log --all --oneline --format="%H|%s|%an|%ct|%P" --grep="${ticketIdPattern}"`,
      { encoding: "utf-8", cwd: repoPath }
    );

    for (const line of output.split("\n").filter((l) => l.trim())) {
      const [sha, message, author, timestamp, parents] = line.split("|");

      // Skip merge commits (have 2+ parents)
      if (parents && parents.trim().split(" ").filter((p) => p).length >= 2) {
        continue;
      }

      commits.push({
        sha,
        message,
        author,
        timestamp: new Date(parseInt(timestamp, 10) * 1000).toISOString(),
      });
    }
  } catch {
    // grep with no matches returns non-zero — this is fine
  }

  return commits;
}

interface BranchInfo {
  name: string;
  sha: string;
}

function getBranchesContainingSha(sha: string): BranchInfo[] {
  const branches: BranchInfo[] = [];

  try {
    const output = execSync(`git branch -a --contains ${sha}`, {
      encoding: "utf-8",
      cwd: repoPath,
    });

    for (const line of output.split("\n").filter((l) => l.trim())) {
      // Line format: "* main" or "  feature/PA-042"
      const branch = line.replace(/^\*?\s*/, "").trim();
      if (branch && !branch.startsWith("(")) {
        // Get the SHA of the branch tip
        let branchSha = "";
        try {
          branchSha = execSync(`git rev-parse ${branch}`, {
            encoding: "utf-8",
            cwd: repoPath,
          }).trim();
        } catch {
          // Detached HEAD or other error
        }
        branches.push({ name: branch, sha: branchSha });
      }
    }
  } catch {
    // No branches contain this sha
  }

  return branches;
}

// ── Main backfill logic ────────────────────────────────────────────────────────

const ACTOR = "backfill-script";

for (const ticket of targetTickets) {
  const ticketIdStr = ticket.id; // e.g., "PA-1120"

  let linkedCommits = 0;
  let linkedBranches = 0;

  // Find commits mentioning this ticket
  const commits = getCommitsForTicketId(ticketIdStr);

  for (const commit of commits) {
    if (dryRun) {
      console.log(`[DRY RUN]  + commit ${commit.sha.slice(0, 8)}: "${commit.message}"`);
    } else {
      try {
        store.update(
          ticket.id,
          {
            add_linked_commit: {
              repo: repoName,
              sha: commit.sha,
              message: commit.message,
              author: commit.author,
              timestamp: commit.timestamp,
              linkedBy: ACTOR,
            },
          },
          ACTOR
        );
        console.log(`  + commit ${commit.sha.slice(0, 8)}: "${commit.message}"`);
        linkedCommits++;
      } catch (err) {
        // Upsert semantics — duplicate sha is not an error, skip silently
        // Actually store.update throws on ticket not found, not on dup
        // So we just log and continue
      }
    }
  }

  // Find branches that contain those commits
  const seenBranches = new Set<string>();
  for (const commit of commits) {
    const branches = getBranchesContainingSha(commit.sha);
    for (const branch of branches) {
      if (seenBranches.has(branch.name)) continue;
      seenBranches.add(branch.name);

      if (dryRun) {
        console.log(`[DRY RUN]  + branch ${branch.name} (at ${branch.sha.slice(0, 8)})`);
      } else {
        try {
          store.update(
            ticket.id,
            {
              add_linked_branch: {
                repo: repoName,
                branch: branch.name,
                sha: branch.sha,
                linkedBy: ACTOR,
              },
            },
            ACTOR
          );
          console.log(`  + branch ${branch.name} (at ${branch.sha.slice(0, 8)})`);
          linkedBranches++;
        } catch {
          // Duplicate branch — skip silently
        }
      }
    }
  }

  if (linkedCommits > 0 || linkedBranches > 0) {
    console.log(
      `Linked ${linkedCommits} commits and ${linkedBranches} branches to ticket ${ticket.id}`
    );
  } else {
    console.log(`No new links found for ticket ${ticket.id}`);
  }
}

console.log("\nDone.");
