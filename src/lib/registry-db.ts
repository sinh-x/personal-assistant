import Database from "better-sqlite3";
import { getRegistryDbPath } from "./paths.js";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

let _db: Database.Database | null = null;

const CURRENT_SCHEMA_VERSION = 4;

function ensureDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function runMigrations(db: Database.Database): void {
  // Create _meta table if not exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS _meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Get current schema version
  const row = db
    .prepare("SELECT value FROM _meta WHERE key = 'schema_version'")
    .get() as { value: string } | undefined;
  const schemaVersion = row ? parseInt(row.value, 10) : 0;

  if (schemaVersion < CURRENT_SCHEMA_VERSION) {
    // Run migration from current version to target
    migrateFrom(db, schemaVersion);

    // Set schema version
    db.exec(`
      INSERT OR REPLACE INTO _meta (key, value) VALUES ('schema_version', '${CURRENT_SCHEMA_VERSION}');
    `);
  }
}

function migrateFrom(db: Database.Database, fromVersion: number): void {
  if (fromVersion < 1) {
    migrateToV1(db);
  }
  if (fromVersion < 2) {
    migrateToV2(db);
  }
  if (fromVersion < 3) {
    migrateToV3(db);
  }
  if (fromVersion < 4) {
    migrateToV4(db);
  }
}

function migrateToV1(db: Database.Database): void {
  // Create registry_events table (raw event log)
  db.exec(`
    CREATE TABLE IF NOT EXISTS registry_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deployment_id TEXT NOT NULL,
      team TEXT NOT NULL,
      event TEXT NOT NULL CHECK (event IN ('started', 'pid', 'completed', 'crashed')),
      timestamp TEXT NOT NULL,
      pid INTEGER,
      status TEXT,
      summary TEXT,
      log_file TEXT,
      primer TEXT,
      agents TEXT,
      models TEXT,
      error TEXT,
      exit_code INTEGER,
      ticket_id TEXT,
      provider TEXT,
      rating TEXT,
      objective TEXT,
      repo TEXT
    );
  `);

  // Create deployments table (materialized view)
  db.exec(`
    CREATE TABLE IF NOT EXISTS deployments (
      deployment_id TEXT PRIMARY KEY,
      team TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unknown',
      started_at TEXT,
      completed_at TEXT,
      pid INTEGER,
      summary TEXT,
      log_file TEXT,
      primer TEXT,
      agents TEXT,
      models TEXT,
      ticket_id TEXT,
      objective TEXT,
      repo TEXT,
      provider TEXT,
      error TEXT,
      exit_code INTEGER,
      rating TEXT
    );
  `);

  // Create indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_events_deployment_id ON registry_events(deployment_id);
    CREATE INDEX IF NOT EXISTS idx_events_timestamp ON registry_events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_deployments_team ON deployments(team);
    CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status);
    CREATE INDEX IF NOT EXISTS idx_deployments_started_at ON deployments(started_at);
    CREATE INDEX IF NOT EXISTS idx_deployments_ticket_id ON deployments(ticket_id);
  `);

  // Create FTS5 virtual table
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS deployments_fts USING fts5(
      deployment_id,
      summary,
      objective,
      content=deployments,
      content_rowid=rowid
    );
  `);

  // Create FTS sync triggers
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS deployments_ai AFTER INSERT ON deployments BEGIN
      INSERT INTO deployments_fts(rowid, deployment_id, summary, objective)
      VALUES (new.rowid, new.deployment_id, new.summary, new.objective);
    END;

    CREATE TRIGGER IF NOT EXISTS deployments_au AFTER UPDATE ON deployments BEGIN
      INSERT INTO deployments_fts(deployments_fts, rowid, deployment_id, summary, objective)
      VALUES ('delete', old.rowid, old.deployment_id, old.summary, old.objective);
      INSERT INTO deployments_fts(rowid, deployment_id, summary, objective)
      VALUES (new.rowid, new.deployment_id, new.summary, new.objective);
    END;

    CREATE TRIGGER IF NOT EXISTS deployments_ad AFTER DELETE ON deployments BEGIN
      INSERT INTO deployments_fts(deployments_fts, rowid, deployment_id, summary, objective)
      VALUES ('delete', old.rowid, old.deployment_id, old.summary, old.objective);
    END;
  `);

  // Create analytics views
  db.exec(`
    CREATE VIEW IF NOT EXISTS v_deployments_per_day AS
      SELECT date(started_at) as day, count(*) as count,
             sum(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successes,
             sum(CASE WHEN status IN ('failed','crashed') THEN 1 ELSE 0 END) as failures
      FROM deployments GROUP BY day;

    CREATE VIEW IF NOT EXISTS v_team_activity AS
      SELECT team, count(*) as total,
             max(started_at) as last_deployment
      FROM deployments GROUP BY team;

    CREATE VIEW IF NOT EXISTS v_rating_trends AS
      SELECT date(started_at) as day, team,
             avg(json_extract(rating, '$.overall')) as avg_overall,
             avg(json_extract(rating, '$.productivity')) as avg_productivity,
             avg(json_extract(rating, '$.quality')) as avg_quality
      FROM deployments
      WHERE rating IS NOT NULL
      GROUP BY day, team;
  `);
}

function migrateToV2(db: Database.Database): void {
  // V2 adds 'amended' to the event CHECK constraint.
  // SQLite does not support ALTER TABLE to modify CHECK constraints,
  // so we use the table rebuild pattern: create new table -> copy data -> drop old -> rename new.
  db.exec("BEGIN TRANSACTION");

  // Create new registry_events table with updated CHECK constraint
  db.exec(`
    CREATE TABLE IF NOT EXISTS registry_events_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deployment_id TEXT NOT NULL,
      team TEXT NOT NULL,
      event TEXT NOT NULL CHECK (event IN ('started', 'pid', 'completed', 'crashed', 'amended')),
      timestamp TEXT NOT NULL,
      pid INTEGER,
      status TEXT,
      summary TEXT,
      log_file TEXT,
      primer TEXT,
      agents TEXT,
      models TEXT,
      error TEXT,
      exit_code INTEGER,
      ticket_id TEXT,
      provider TEXT,
      rating TEXT,
      objective TEXT,
      repo TEXT
    );
  `);

  // Copy data from old table to new table
  db.exec(`
    INSERT INTO registry_events_v2 SELECT * FROM registry_events;
  `);

  // Drop old table and rename new table
  db.exec(`
    DROP TABLE registry_events;
    ALTER TABLE registry_events_v2 RENAME TO registry_events;
  `);

  // Recreate indexes (they were dropped when table was dropped)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_events_deployment_id ON registry_events(deployment_id);
    CREATE INDEX IF NOT EXISTS idx_events_timestamp ON registry_events(timestamp);
  `);

  db.exec("COMMIT");
}

function migrateToV3(db: Database.Database): void {
  // V3 adds fallback column to both tables.
  // SQLite supports ALTER TABLE ADD COLUMN without table rebuild.
  db.exec(`
    ALTER TABLE registry_events ADD COLUMN fallback INTEGER DEFAULT 0;
  `);
  db.exec(`
    ALTER TABLE deployments ADD COLUMN fallback INTEGER DEFAULT 0;
  `);
}

function migrateToV4(db: Database.Database): void {
  // V4 adds resumed_from_deployment_id column to both tables.
  // SQLite supports ALTER TABLE ADD COLUMN without table rebuild.
  db.exec(`
    ALTER TABLE registry_events ADD COLUMN resumed_from_deployment_id TEXT;
  `);
  db.exec(`
    ALTER TABLE deployments ADD COLUMN resumed_from_deployment_id TEXT;
  `);
}

/**
 * Get the singleton database connection.
 * Initializes WAL mode, creates schema if needed, and runs migrations.
 */
export function getDb(): Database.Database {
  if (!_db) {
    const dbPath = getRegistryDbPath();
    ensureDir(dbPath);
    _db = new Database(dbPath);
    _db.pragma("journal_mode = WAL");
    _db.pragma("busy_timeout = 5000");
    _db.pragma("foreign_keys = ON");
    runMigrations(_db);
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
