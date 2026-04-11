/**
 * TypeScript interfaces for repo-health data structures.
 * Matches JSON snapshot schema v1 and SQLite schema.
 */

// ---------------------------------------------------------------------------
// JSON Snapshot Schema Types
// ---------------------------------------------------------------------------

export interface RepoHealthReport {
  schemaVersion: 1;
  repoKey: string;
  repoPath: string;
  generatedAt: string; // ISO 8601
  gitHead: string | null;
  lastReportAt: string | null; // ISO 8601, null for first run
  branchStats: BranchStats;
  commitStats: CommitStats;
  ticketStats: TicketStats;
  staleBranches: StaleBranch[];
  mergedBranches: MergedBranch[];
  healthScore: number; // 0–100
  healthNotes: string[];
}

export interface BranchStats {
  total: number;
  merged: number;
  stale: number;
  active: number;
  deleted: number;
  remoteRefsPruned: number;
}

export interface CommitStats {
  sinceLastReport: number;
  firstCommitDate: string | null; // ISO date or null
  lastCommitDate: string | null;
  topAuthors: AuthorCount[];
}

export interface AuthorCount {
  name: string;
  count: number;
}

export interface TicketStats {
  doneSinceLastReport: string[]; // ticket IDs e.g. ["PA-100", "PA-101"]
  doneCount: number;
  activeCount: number;
  byStatus: Record<string, number>;
}

export interface StaleBranch {
  name: string;
  lastCommitDate: string; // ISO date
  daysSinceCommit: number;
}

export interface MergedBranch {
  name: string;
  action: "deleted" | "pruned" | "dry-run";
}

// ---------------------------------------------------------------------------
// SQLite Row Types (database persistence)
// ---------------------------------------------------------------------------

export interface RepoHealthReportRow {
  id?: number;
  repo_key: string;
  repo_path: string;
  generated_at: string; // ISO 8601
  git_head: string | null;
  last_report_at: string | null;
  // Branch stats
  total_branches: number;
  merged_branches: number;
  stale_branches: number;
  active_branches: number;
  branches_deleted: number;
  remote_refs_pruned: number;
  // Commit stats
  commits_since_last: number;
  first_commit_date: string | null;
  last_commit_date: string | null;
  top_authors: string; // JSON array of AuthorCount
  // Ticket stats
  tickets_done_count: number;
  tickets_done_ids: string; // JSON array of ticket IDs
  tickets_active: number;
  tickets_by_status: string; // JSON object
  // Health
  health_score: number;
  health_notes: string; // JSON array of strings
}

export interface RepoHealthBranchRow {
  id?: number;
  report_id: number;
  branch_name: string;
  status: "merged" | "active" | "stale";
  last_commit_date: string | null; // ISO date
  days_since_commit: number | null;
  action: "deleted" | "pruned" | "kept" | "dry-run" | null;
}

// ---------------------------------------------------------------------------
// Convenience Types for DB Operations
// ---------------------------------------------------------------------------

/** Minimal subset of RepoHealthReport needed to insert a new report row */
export type ReportInsert = Omit<
  RepoHealthReportRow,
  "id"
>;

/** A branch record ready for insertion */
export type BranchInsert = Omit<RepoHealthBranchRow, "id">;
