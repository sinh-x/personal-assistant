#!/usr/bin/env node
/**
 * Migration script: backfill blockedBy: [] into tickets missing the field.
 *
 * Logic per ticket:
 *   - If ticket already has `blockedBy` field (array or null) → skip (already migrated, idempotent)
 *   - If ticket is missing `blockedBy` field → add `blockedBy: []`
 *   - Write back with atomic file write
 *
 * Backup: copies all ticket JSON files to <tickets-dir>/backup-blockedby-YYYYMMDDTHHMMSS/
 * before making any changes.
 *
 * Usage:
 *   npx tsx scripts/migrate_blockedby.ts [--dry-run]
 *
 * Flags:
 *   --dry-run  Print what would change without modifying any files
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { homedir } from "node:os";

const TICKETS_DIR = resolve(homedir(), "Documents/ai-usage/tickets");
const DRY_RUN = process.argv.includes("--dry-run");

interface Ticket {
  id: string;
  blockedBy?: unknown;
  [key: string]: unknown;
}

/** Format a timestamp for backup directory name */
function formatTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace("T", "T").slice(0, 15);
}

/** Back up all ticket JSON files */
function backupTickets(ticketFiles: string[]): string {
  const backupDir = resolve(TICKETS_DIR, `backup-blockedby-${formatTimestamp(new Date())}`);
  if (!DRY_RUN) {
    mkdirSync(backupDir, { recursive: true });
    for (const file of ticketFiles) {
      copyFileSync(file, resolve(backupDir, basename(file)));
    }
  }
  return backupDir;
}

/** Read all ticket JSON files (excluding counter.json and audit.jsonl) */
function readTicketFiles(): string[] {
  if (!existsSync(TICKETS_DIR)) {
    throw new Error(`Tickets directory not found: ${TICKETS_DIR}`);
  }
  return readdirSync(TICKETS_DIR)
    .filter((f) => f.endsWith(".json") && f !== "counter.json" && f !== "audit.jsonl")
    .map((f) => resolve(TICKETS_DIR, f));
}

async function main(): Promise<void> {
  console.log(`[migrate_blockedby] ${DRY_RUN ? "DRY RUN — " : ""}Starting migration`);
  console.log(`Tickets directory: ${TICKETS_DIR}`);

  const ticketFiles = readTicketFiles();
  console.log(`Found ${ticketFiles.length} ticket file(s)\n`);

  if (ticketFiles.length === 0) {
    console.log("Nothing to migrate.");
    return;
  }

  // Step 1: Backup
  if (!DRY_RUN) {
    const backupDir = backupTickets(ticketFiles);
    console.log(`Backup created: ${backupDir}\n`);
  } else {
    console.log("(dry-run: backup would be created)\n");
  }

  let alreadyMigrated = 0;
  let fixed = 0;
  const errors: string[] = [];

  for (const filePath of ticketFiles) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(filePath, "utf-8"));
    } catch (err) {
      errors.push(`  PARSE ERROR ${basename(filePath)}: ${err}`);
      continue;
    }

    const ticket = raw as Ticket;

    // Idempotency: skip tickets already having blockedBy field
    if ("blockedBy" in ticket) {
      alreadyMigrated++;
      continue;
    }

    // Ticket is missing blockedBy — add it
    fixed++;

    if (DRY_RUN) {
      console.log(`  [WOULD FIX] ${ticket.id}: missing blockedBy → blockedBy: []`);
    } else {
      const newTicket = { ...ticket, blockedBy: [] };
      writeFileSync(filePath, JSON.stringify(newTicket, null, 2));
      console.log(`  [FIXED]     ${ticket.id}: added blockedBy: []`);
    }
  }

  // Summary
  console.log("\n=== Migration Summary ===");
  console.log(`  Total ticket files:         ${ticketFiles.length}`);
  console.log(`  Already have blockedBy:     ${alreadyMigrated}`);
  console.log(`  Fixed (added blockedBy: []): ${fixed}`);
  console.log(`  Errors:                     ${errors.length}`);

  if (errors.length > 0) {
    console.error("\nErrors encountered:");
    for (const e of errors) console.error(e);
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log("\n[dry-run] No files written.");
  } else {
    console.log("\nMigration complete.");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});