/**
 * SQLite helpers for repo-health database.
 * Provides functions to initialize the DB, insert reports, and query history.
 */

import Database from "better-sqlite3";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  RepoHealthReport,
  RepoHealthReportRow,
  RepoHealthBranchRow,
  ReportInsert,
  BranchInsert,
} from "./schema.js";

// ---------------------------------------------------------------------------
// Path Resolution
// ---------------------------------------------------------------------------

function expandHome(p: string): string {
  if (p.startsWith("~")) {
    return join(homedir(), p.slice(2));
  }
  return p;
}

/** Knowledge-base directory — ~/Documents/ai-usage/knowledge-base */
export function getKnowledgeBaseDir(): string {
  return expandHome("~/Documents/ai-usage/knowledge-base");
}

/** Repo-health database path — knowledge-base/repo-health.db */
export function getRepoHealthDbPath(): string {
  return `${getKnowledgeBaseDir()}/repo-health.db`;
}

/** Repo-health snapshot directory — knowledge-base/repo-health/ */
export function getRepoHealthDir(): string {
  return `${getKnowledgeBaseDir()}/repo-health`;
}

// ---------------------------------------------------------------------------
// Database Initialization
// ---------------------------------------------------------------------------

let _db: Database.Database | null = null;

function ensureDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function createTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS reports (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_key             TEXT    NOT NULL,
      repo_path            TEXT    NOT NULL,
      generated_at         TEXT    NOT NULL,
      git_head             TEXT,
      last_report_at       TEXT,
      -- Branch stats
      total_branches       INTEGER DEFAULT 0,
      merged_branches      INTEGER DEFAULT 0,
      stale_branches       INTEGER DEFAULT 0,
      active_branches      INTEGER DEFAULT 0,
      branches_deleted    INTEGER DEFAULT 0,
      remote_refs_pruned   INTEGER DEFAULT 0,
      -- Commit stats
      commits_since_last  INTEGER DEFAULT 0,
      first_commit_date   TEXT,
      last_commit_date    TEXT,
      top_authors          TEXT,
      -- Ticket stats
      tickets_done_count  INTEGER DEFAULT 0,
      tickets_done_ids    TEXT,
      tickets_active      INTEGER DEFAULT 0,
      tickets_by_status   TEXT,
      -- Health
      health_score        INTEGER DEFAULT 0,
      health_notes        TEXT
    );

    CREATE TABLE IF NOT EXISTS branches (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id           INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
      branch_name         TEXT    NOT NULL,
      status              TEXT    NOT NULL,
      last_commit_date    TEXT,
      days_since_commit   INTEGER,
      action              TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_reports_repo_key      ON reports(repo_key);
    CREATE INDEX IF NOT EXISTS idx_reports_generated_at  ON reports(generated_at);
    CREATE INDEX IF NOT EXISTS idx_branches_report_id    ON branches(report_id);
  `);
}

/**
 * Get the singleton database connection.
 * Initializes WAL mode, creates schema if needed.
 */
export function getDb(): Database.Database {
  if (!_db) {
    const dbPath = getRepoHealthDbPath();
    ensureDir(dbPath);
    _db = new Database(dbPath);
    _db.pragma("journal_mode = WAL");
    _db.pragma("busy_timeout = 5000");
    _db.pragma("foreign_keys = ON");
    createTables(_db);
  }
  return _db;
}

/**
 * Close the database connection.
 * Mainly useful for testing.
 */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

// ---------------------------------------------------------------------------
// Insert Operations
// ---------------------------------------------------------------------------

/**
 * Insert a new report row and its associated branch rows.
 * Returns the inserted report ID.
 */
export function insertReport(
  report: ReportInsert,
  branches: BranchInsert[]
): number {
  const db = getDb();

  const insertReportStmt = db.prepare(`
    INSERT INTO reports (
      repo_key, repo_path, generated_at, git_head, last_report_at,
      total_branches, merged_branches, stale_branches, active_branches,
      branches_deleted, remote_refs_pruned,
      commits_since_last, first_commit_date, last_commit_date, top_authors,
      tickets_done_count, tickets_done_ids, tickets_active, tickets_by_status,
      health_score, health_notes
    ) VALUES (
      @repo_key, @repo_path, @generated_at, @git_head, @last_report_at,
      @total_branches, @merged_branches, @stale_branches, @active_branches,
      @branches_deleted, @remote_refs_pruned,
      @commits_since_last, @first_commit_date, @last_commit_date, @top_authors,
      @tickets_done_count, @tickets_done_ids, @tickets_active, @tickets_by_status,
      @health_score, @health_notes
    )
  `);

  const insertBranchStmt = db.prepare(`
    INSERT INTO branches (
      report_id, branch_name, status, last_commit_date, days_since_commit, action
    ) VALUES (
      @report_id, @branch_name, @status, @last_commit_date, @days_since_commit, @action
    )
  `);

  const transaction = db.transaction(() => {
    const reportId = (
      insertReportStmt.run({
        repo_key: report.repo_key,
        repo_path: report.repo_path,
        generated_at: report.generated_at,
        git_head: report.git_head,
        last_report_at: report.last_report_at,
        total_branches: report.total_branches,
        merged_branches: report.merged_branches,
        stale_branches: report.stale_branches,
        active_branches: report.active_branches,
        branches_deleted: report.branches_deleted,
        remote_refs_pruned: report.remote_refs_pruned,
        commits_since_last: report.commits_since_last,
        first_commit_date: report.first_commit_date,
        last_commit_date: report.last_commit_date,
        top_authors: report.top_authors,
        tickets_done_count: report.tickets_done_count,
        tickets_done_ids: report.tickets_done_ids,
        tickets_active: report.tickets_active,
        tickets_by_status: report.tickets_by_status,
        health_score: report.health_score,
        health_notes: report.health_notes,
      })
    ).lastInsertRowid as number;

    for (const branch of branches) {
      insertBranchStmt.run({
        report_id: reportId,
        branch_name: branch.branch_name,
        status: branch.status,
        last_commit_date: branch.last_commit_date,
        days_since_commit: branch.days_since_commit,
        action: branch.action,
      });
    }

    return reportId;
  });

  return transaction();
}

/**
 * Convert a database row back to a RepoHealthReport.
 * Reconstructs the JSON-snapshot view from the SQLite row.
 */
export function rowToReport(row: RepoHealthReportRow): RepoHealthReport {
  return {
    schemaVersion: 1,
    repoKey: row.repo_key,
    repoPath: row.repo_path,
    generatedAt: row.generated_at,
    gitHead: row.git_head,
    lastReportAt: row.last_report_at,
    branchStats: {
      total: row.total_branches,
      merged: row.merged_branches,
      stale: row.stale_branches,
      active: row.active_branches,
      deleted: row.branches_deleted,
      remoteRefsPruned: row.remote_refs_pruned,
    },
    commitStats: {
      sinceLastReport: row.commits_since_last,
      firstCommitDate: row.first_commit_date,
      lastCommitDate: row.last_commit_date,
      topAuthors: JSON.parse(row.top_authors || "[]"),
    },
    ticketStats: {
      doneSinceLastReport: JSON.parse(row.tickets_done_ids || "[]"),
      doneCount: row.tickets_done_count,
      activeCount: row.tickets_active,
      byStatus: JSON.parse(row.tickets_by_status || "{}"),
    },
    healthScore: row.health_score,
    healthNotes: JSON.parse(row.health_notes || "[]"),
    staleBranches: [],
    mergedBranches: [],
  };
}

// ---------------------------------------------------------------------------
// Query Operations
// ---------------------------------------------------------------------------

/**
 * Fetch the most recent report for a given repo key.
 */
export function getLatestReport(repoKey: string): RepoHealthReportRow | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT * FROM reports
       WHERE repo_key = ?
       ORDER BY generated_at DESC
       LIMIT 1`
    )
    .get(repoKey) as RepoHealthReportRow | undefined;
  return row ?? null;
}

/**
 * Fetch the most recent report for a given repo key, with branch details.
 * Returns both the report and its associated branch rows.
 */
export function getLatestReportWithBranches(
  repoKey: string
): { report: RepoHealthReportRow | null; branches: RepoHealthBranchRow[] } {
  const db = getDb();
  const report = getLatestReport(repoKey);
  if (!report) {
    return { report: null, branches: [] };
  }

  const branches = db
    .prepare("SELECT * FROM branches WHERE report_id = ?")
    .all(report.id) as RepoHealthBranchRow[];

  return { report, branches };
}

/**
 * Fetch historical reports for a given repo key, most recent first.
 */
export function listReports(
  repoKey: string,
  limit = 10
): RepoHealthReportRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM reports
       WHERE repo_key = ?
       ORDER BY generated_at DESC
       LIMIT ?`
    )
    .all(repoKey, limit) as RepoHealthReportRow[];
}
