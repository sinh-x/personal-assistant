#!/usr/bin/env node
/**
 * Migration script: normalize ticket project values to canonical repos.yaml keys.
 *
 * Tickets created with non-canonical project values (e.g. "personal-assistant"
 * instead of "pa") are resolved to their canonical key using resolveProject().
 * Resolution order: exact key → prefix (case-insensitive) → path basename.
 *
 * Logic per ticket:
 *   - project is already a canonical key → skip (idempotent)
 *   - project resolves to a different canonical key → update project field
 *   - project cannot be resolved → log as unresolvable, skip
 *
 * Backup: copies all ticket JSON files to <tickets-dir>/backup-YYYYMMDDTHHMMSS/
 * before making any changes.
 *
 * Usage:
 *   npx tsx scripts/migrate-ticket-projects.ts [--dry-run]
 *
 * Flags:
 *   --dry-run  Print what would change without modifying any files
 */

import {
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  copyFileSync,
  existsSync,
} from "node:fs";
import { resolve, basename } from "node:path";
import { homedir } from "node:os";
import { resolveProject, listRepos } from "../src/lib/repos.js";

const TICKETS_DIR = resolve(homedir(), "Documents/ai-usage/tickets");
const DRY_RUN = process.argv.includes("--dry-run");

interface TicketData {
  id?: string;
  project?: string;
  [key: string]: unknown;
}

/** Format a timestamp as YYYYMMDDTHHMMSS for backup directory name */
function formatTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace("T", "T").slice(0, 15);
}

/** Back up all ticket JSON files to a timestamped subdirectory */
function backupTickets(ticketFiles: string[]): string {
  const backupDir = resolve(TICKETS_DIR, `backup-${formatTimestamp(new Date())}`);
  mkdirSync(backupDir, { recursive: true });
  for (const file of ticketFiles) {
    copyFileSync(file, resolve(backupDir, basename(file)));
  }
  return backupDir;
}

/** Read all ticket JSON files from the tickets directory */
function readTicketFiles(): string[] {
  if (!existsSync(TICKETS_DIR)) {
    throw new Error(`Tickets directory not found: ${TICKETS_DIR}`);
  }
  return readdirSync(TICKETS_DIR)
    .filter((f) => f.endsWith(".json") && f !== "counter.json")
    .map((f) => resolve(TICKETS_DIR, f));
}

/** Get the set of canonical project keys from repos.yaml */
function getCanonicalKeys(): Set<string> {
  const repos = listRepos();
  return new Set(repos.filter((r) => r.prefix).map((r) => r.name));
}

function main(): void {
  console.log(`[migrate-ticket-projects] ${DRY_RUN ? "DRY RUN — " : ""}Starting migration`);
  console.log(`Tickets directory: ${TICKETS_DIR}\n`);

  const canonicalKeys = getCanonicalKeys();

  const ticketFiles = readTicketFiles();
  console.log(`Found ${ticketFiles.length} ticket file(s)\n`);

  if (ticketFiles.length === 0) {
    console.log("Nothing to migrate.");
    return;
  }

  // Pass 1: Classify each ticket
  const toMigrate: Array<{ file: string; id: string; oldProject: string; newKey: string }> = [];
  const unresolvable: Array<{ file: string; id: string; project: string; error: string }> = [];
  const errors: string[] = [];
  let alreadyCanonical = 0;
  let noProject = 0;

  for (const file of ticketFiles) {
    let ticket: TicketData;
    try {
      ticket = JSON.parse(readFileSync(file, "utf-8")) as TicketData;
    } catch (err) {
      errors.push(`  PARSE ERROR ${basename(file)}: ${err}`);
      continue;
    }

    const id = ticket.id ?? basename(file, ".json");
    const project = ticket.project;

    if (!project) {
      noProject++;
      continue;
    }

    if (canonicalKeys.has(project)) {
      alreadyCanonical++;
      continue;
    }

    try {
      const resolved = resolveProject(project);
      if (resolved.key !== project) {
        toMigrate.push({ file, id, oldProject: project, newKey: resolved.key });
      } else {
        // resolveProject returned same value → treat as canonical
        alreadyCanonical++;
      }
    } catch (err) {
      unresolvable.push({ file, id, project, error: String(err) });
    }
  }

  // Summary of analysis
  console.log("--- Analysis ---");
  console.log(`  Total files:       ${ticketFiles.length}`);
  console.log(`  Already canonical: ${alreadyCanonical}`);
  console.log(`  To migrate:        ${toMigrate.length}`);
  console.log(`  Unresolvable:      ${unresolvable.length}`);
  console.log(`  No project field:  ${noProject}`);
  console.log(`  Parse errors:      ${errors.length}`);
  console.log();

  if (unresolvable.length > 0) {
    console.log("Unresolvable (skipped):");
    for (const item of unresolvable) {
      console.log(`  ${item.id}: project="${item.project}" — ${item.error}`);
    }
    console.log();
  }

  if (errors.length > 0) {
    console.error("Parse errors:");
    for (const e of errors) console.error(e);
    console.log();
  }

  if (toMigrate.length === 0) {
    console.log("Nothing to migrate. All tickets have canonical project values.");
    return;
  }

  // Show sample of migrations
  const sample = toMigrate.slice(0, 10);
  console.log(`Sample of planned migrations (showing ${sample.length} of ${toMigrate.length}):`);
  const grouped = new Map<string, number>();
  for (const item of toMigrate) {
    const key = `"${item.oldProject}" → "${item.newKey}"`;
    grouped.set(key, (grouped.get(key) ?? 0) + 1);
  }
  for (const [mapping, count] of grouped.entries()) {
    console.log(`  ${mapping}: ${count} ticket(s)`);
  }
  console.log();

  if (DRY_RUN) {
    console.log("DRY RUN complete. No files modified.");
    return;
  }

  // Backup all tickets before any writes
  const backupDir = backupTickets(ticketFiles);
  console.log(`Backup created: ${backupDir}\n`);

  // Pass 2: Apply migrations
  let migrated = 0;
  let skipped = 0;
  let writeErrors = 0;

  for (const item of toMigrate) {
    let ticket: TicketData;
    try {
      ticket = JSON.parse(readFileSync(item.file, "utf-8")) as TicketData;
    } catch (err) {
      console.error(`  ERROR reading ${item.id}: ${err}`);
      writeErrors++;
      continue;
    }

    // Idempotency: skip if project already canonical (safe to re-run)
    if (!ticket.project || canonicalKeys.has(ticket.project)) {
      console.log(`  SKIP ${item.id}: project already canonical ("${ticket.project}")`);
      skipped++;
      continue;
    }

    ticket.project = item.newKey;

    try {
      writeFileSync(item.file, JSON.stringify(ticket, null, 2));
      console.log(`  MIGRATED ${item.id}: "${item.oldProject}" → "${item.newKey}"`);
      migrated++;
    } catch (err) {
      console.error(`  ERROR writing ${item.id}: ${err}`);
      writeErrors++;
    }
  }

  // Final summary
  console.log("\n--- Migration Summary ---");
  console.log(`  Migrated:    ${migrated}`);
  console.log(`  Skipped:     ${skipped}  (already canonical)`);
  console.log(`  Unresolved:  ${unresolvable.length}  (no matching repo)`);
  console.log(`  Errors:      ${writeErrors}`);
  console.log(`  Backup:      ${backupDir}`);

  if (writeErrors > 0) {
    process.exit(1);
  }
}

main();
