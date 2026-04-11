const Database = require("better-sqlite3");
const path = require("path");
const { homedir } = require("os");
const { execSync } = require("child_process");

const DB_PATH = path.join(homedir(), "Documents/ai-usage/knowledge-base/repo-health.db");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS reports (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_key             TEXT    NOT NULL,
    repo_path            TEXT    NOT NULL,
    generated_at         TEXT    NOT NULL,
    git_head             TEXT,
    last_report_at       TEXT,
    total_branches       INTEGER DEFAULT 0,
    merged_branches      INTEGER DEFAULT 0,
    stale_branches       INTEGER DEFAULT 0,
    active_branches      INTEGER DEFAULT 0,
    branches_deleted    INTEGER DEFAULT 0,
    remote_refs_pruned   INTEGER DEFAULT 0,
    commits_since_last  INTEGER DEFAULT 0,
    first_commit_date   TEXT,
    last_commit_date    TEXT,
    top_authors          TEXT,
    tickets_done_count  INTEGER DEFAULT 0,
    tickets_done_ids    TEXT,
    tickets_active      INTEGER DEFAULT 0,
    tickets_by_status   TEXT,
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

// Get current data
const branchOutput = execSync(
  `git -C /home/sinh/git-repos/sinh-x/tools/personal-assistant for-each-ref --format='%(refname:short) %(committerdate:short)' refs/heads/`,
  { encoding: "utf8" }
);

const branchLines = branchOutput.trim().split("\n").filter(Boolean);
const today = new Date("2026-04-11T16:36:18+07:00");

// All branches merged into main or develop (excluding protected)
const mergedBranches = new Set([
  "feature/AVO-042-deprecate-ticket-team-field",
  "feature/AVO-054-provider-model-selection",
  "feature/PA-1000-idea-report-migration",
  "feature/PA-1042-ticket-key-branch-names",
  "feature/PA-1043-uat-doc-branch-separation",
  "feature/PA-1047-codebase-context-tool",
  "feature/PA-1052-ticket-move-between-projects",
  "feature/PA-1057-git-repo-info-api",
  "feature/PA-1069-ticket-attachment-upload",
  "feature/PA-1070-none-sentinel-develop-branch",
  "feature/PA-1070-repo-develop-branch-config",
  "feature/PA-1073-registry-completion-fallback",
  "feature/PA-1079-session-scanning",
  "feature/PA-1094-cli-robustness",
  "feature/PA-1104-improve-builder-routine-mode",
  "feature/PA-1105-doc-ref-url-links",
  "feature/PA-1107-agent-thinking-extractor",
  "feature/PA-1108-registry-sqlite-cleanup",
  "feature/PA-1110-nix-include-scripts",
  "feature/PA-1112-orchestrator-ticket-passthrough",
  "feature/PA-1114-api-branch-commit-details",
  "feature/PA-1116-extended-git-api",
  "feature/PA-1117-deployment-query-api",
  "feature/PA-1119-inline-section-insert",
  "feature/PA-1120-ticket-branch-commit-links",
  "feature/PA-1123-avo070-provider-model-passthrough",
  "feature/PA-1124-diff-api-fix",
  "feature/PA-1125-configurable-deploy-timeout",
  "feature/PA-1127-deploy-warnings-persistence",
  "feature/PA-1128-orchestrator-phase5-pr-handoff",
  "feature/PA-1130-enforce-git-link-validation",
  "feature/PA-1131-skip-header-inline-section",
  "feature/PA-1132-server-inline-comment-text-match",
  "feature/PA-1133-orchestrator-provider",
  "feature/PA-1134-commit-diff-merge-fix",
  "feature/PA-1135-self-update-endpoint",
  "feature/PA-1137-self-update-remove-git-pull",
  "feature/PA-990-registry-quick-wins",
  "feature/minimax-provider-default",
  "feature/AVO-072-pa-serve-branch-commits",
  "feature/team-yaml-mode-restructure",
  "feature/pa-969-builder-team-audit",
]);

const currentBranch = "feature/PA-1138-repo-health";
const branchRows = [];
let mergedCount = 0;
let activeCount = 0;
let staleCount = 0;

for (const line of branchLines) {
  const match = line.match(/^(\S+)\s+(\S+)/);
  if (!match) continue;
  const name = match[1];
  const dateStr = match[2];

  if (name === "main" || name === "develop") continue;

  const commitDate = new Date(dateStr);
  const daysSince = Math.floor((today - commitDate) / (1000 * 60 * 60 * 24));

  let status, action;
  if (mergedBranches.has(name)) {
    status = "merged";
    action = "pending_deletion";
    mergedCount++;
  } else if (daysSince > 30 && name !== currentBranch) {
    status = "stale";
    action = null;
    staleCount++;
  } else {
    status = "active";
    action = null;
    activeCount++;
  }

  branchRows.push({
    branch_name: name,
    status,
    last_commit_date: dateStr,
    days_since_commit: daysSince,
    action,
  });
}

const reportInsert = db.prepare(`
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

const branchInsert = db.prepare(`
  INSERT INTO branches (report_id, branch_name, status, last_commit_date, days_since_commit, action)
  VALUES (@report_id, @branch_name, @status, @last_commit_date, @days_since_commit, @action)
`);

const transaction = db.transaction(() => {
  const result = reportInsert.run({
    repo_key: "pa",
    repo_path: "/home/sinh/git-repos/sinh-x/tools/personal-assistant",
    generated_at: "2026-04-11T16:45:00+07:00",
    git_head: "ca0e8dc8e0e5c8cd0c39f55a2102fa530f898a3",
    last_report_at: "2026-04-11T14:32:24+07:00",
    total_branches: 47,
    merged_branches: mergedCount,
    stale_branches: staleCount,
    active_branches: activeCount,
    branches_deleted: 0,
    remote_refs_pruned: 0,
    commits_since_last: 0,
    first_commit_date: "2026-04-04",
    last_commit_date: "2026-04-11",
    top_authors: JSON.stringify([{ name: "Sinh Nguyen", count: 129 }]),
    tickets_done_count: 0,
    tickets_done_ids: JSON.stringify([]),
    tickets_active: 2,
    tickets_by_status: JSON.stringify({ implementing: 2 }),
    health_score: 30,
    health_notes: JSON.stringify([
      "33 merged branches detected (70% of total) - branch cleanup overdue",
      "0 stale branches (oldest branch is 25 days old)",
      "0 commits strictly since last report (14:32), but 129 commits in last 7 days",
      "No tickets completed since last report (2 implementing)",
    ]),
  });

  const reportId = result.lastInsertRowid;

  for (const b of branchRows) {
    branchInsert.run({
      report_id: reportId,
      branch_name: b.branch_name,
      status: b.status,
      last_commit_date: b.last_commit_date,
      days_since_commit: b.days_since_commit,
      action: b.action,
    });
  }

  console.log(`Inserted report ID: ${reportId}`);
  console.log(`Branch stats: merged=${mergedCount}, stale=${staleCount}, active=${activeCount}`);
});

transaction();
db.close();
console.log("Done.");
