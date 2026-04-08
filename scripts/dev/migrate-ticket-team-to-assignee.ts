#!/usr/bin/env node
/**
 * Migration script: remove `team` field from all tickets, migrating its value
 * into `assignee` where assignee is currently empty.
 *
 * Logic per ticket:
 *   - If assignee is empty and team is set  → copy team → assignee, remove team
 *   - If both assignee and team are set     → keep assignee (more specific), remove team
 *   - If only assignee is set               → no data change, remove team (already empty)
 *   - If neither is set                     → remove team field, assignee stays empty
 *
 * Backup: copies all ticket JSON files to <tickets-dir>/backup-YYYYMMDDTHHMMSS/
 * before making any changes.
 *
 * Usage:
 *   npx tsx scripts/migrate-ticket-team-to-assignee.ts [--dry-run]
 *
 * Flags:
 *   --dry-run  Print what would change without modifying any files
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { homedir } from "node:os";

const TICKETS_DIR = resolve(homedir(), "Documents/ai-usage/tickets");
const DRY_RUN = process.argv.includes("--dry-run");

interface TicketData {
  id: string;
  project?: string;
  team?: string;
  assignee?: string;
  [key: string]: unknown;
}

/** Format a timestamp as YYYYMMDDTHHMMSS for backup directory name */
function formatTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace("T", "T").slice(0, 15);
}

/** Back up all ticket JSON files to a timestamped subdirectory */
function backupTickets(ticketFiles: string[]): string {
  const backupDir = resolve(TICKETS_DIR, `backup-${formatTimestamp(new Date())}`);
  if (!DRY_RUN) {
    mkdirSync(backupDir, { recursive: true });
    for (const file of ticketFiles) {
      copyFileSync(file, resolve(backupDir, basename(file)));
    }
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

/** Apply the team→assignee migration to a single ticket object */
function migrateTicket(ticket: TicketData): { migrated: TicketData; action: string } {
  const { team, assignee, ...rest } = ticket;

  let newAssignee = assignee ?? "";
  let action = "no-change";

  if (team && !assignee) {
    // Case: only team is set → promote to assignee
    newAssignee = team;
    action = `promoted team "${team}" to assignee`;
  } else if (team && assignee) {
    // Case: both set → keep assignee, discard team
    action = `kept assignee "${assignee}", dropped team "${team}"`;
  } else if (!team && assignee) {
    // Case: only assignee → nothing to migrate
    action = "no team field to migrate";
  } else {
    // Case: neither set
    action = "both empty, removed team field";
  }

  // Build migrated record without `team` field
  const migrated: TicketData = {
    ...rest,
    assignee: newAssignee,
  };

  return { migrated, action };
}

/** Validate that migrated ticket has no `team` field */
function validateTicket(ticket: TicketData, filePath: string): void {
  if ("team" in ticket) {
    throw new Error(`Validation failed: 'team' field still present in ${filePath}`);
  }
  if (!("assignee" in ticket)) {
    throw new Error(`Validation failed: 'assignee' field missing in ${filePath}`);
  }
}

async function main(): Promise<void> {
  console.log(`[migrate-ticket-team-to-assignee] ${DRY_RUN ? "DRY RUN — " : ""}Starting migration`);
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

  // Step 2: Transform
  let promoted = 0;
  let dropped = 0;
  let noChange = 0;
  const errors: string[] = [];

  for (const filePath of ticketFiles) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(filePath, "utf-8"));
    } catch (err) {
      errors.push(`  PARSE ERROR ${basename(filePath)}: ${err}`);
      continue;
    }

    const ticket = raw as TicketData;
    const { migrated, action } = migrateTicket(ticket);

    if (action.startsWith("promoted")) {
      promoted++;
      console.log(`  [PROMOTE] ${ticket.id ?? basename(filePath)}: ${action}`);
    } else if (action.startsWith("kept") || action.startsWith("both")) {
      dropped++;
      console.log(`  [DROP]    ${ticket.id ?? basename(filePath)}: ${action}`);
    } else {
      noChange++;
    }

    // Step 3: Validate
    try {
      validateTicket(migrated, filePath);
    } catch (err) {
      errors.push(`  VALIDATION ERROR ${basename(filePath)}: ${err}`);
      continue;
    }

    // Write transformed ticket
    if (!DRY_RUN) {
      writeFileSync(filePath, JSON.stringify(migrated, null, 2));
    }
  }

  // Step 4: Summary
  console.log(`\n--- Migration Summary ---`);
  console.log(`  Total files:    ${ticketFiles.length}`);
  console.log(`  Promoted:       ${promoted}  (team → assignee)`);
  console.log(`  Dropped:        ${dropped}   (had both, kept assignee)`);
  console.log(`  No change:      ${noChange}`);
  console.log(`  Errors:         ${errors.length}`);

  if (errors.length > 0) {
    console.error("\nErrors encountered:");
    for (const e of errors) console.error(e);
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log("\n(dry-run: no files were modified)");
  } else {
    console.log("\nMigration complete.");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
