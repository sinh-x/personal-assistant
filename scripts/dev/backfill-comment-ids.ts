#!/usr/bin/env node
/**
 * Migration script: add UUID `id` field to all Comment objects missing one.
 *
 * Reads all ticket JSON files in the tickets directory, generates a UUID for
 * any comment that lacks an `id` field, and writes the updated ticket back.
 *
 * Run once after deploying PA-890 Phase 1. Safe to re-run — comments that
 * already have an `id` are left untouched.
 *
 * Backup: copies all ticket JSON files to <tickets-dir>/backup-YYYYMMDDTHHMMSS/
 * before making any changes.
 *
 * Usage:
 *   npx tsx scripts/backfill-comment-ids.ts [--dry-run]
 *
 * Flags:
 *   --dry-run  Print what would change without modifying any files
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

const TICKETS_DIR = resolve(homedir(), "Documents/ai-usage/tickets");
const DRY_RUN = process.argv.includes("--dry-run");

interface CommentData {
  id?: string;
  author: string;
  content: string;
  timestamp: string;
  editedAt?: string;
}

interface TicketData {
  id: string;
  comments?: CommentData[];
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

function main(): void {
  const files = readdirSync(TICKETS_DIR).filter(
    (f) => f.endsWith(".json") && f !== "counter.json" && !f.startsWith("backup-")
  );

  if (files.length === 0) {
    console.log("No ticket files found.");
    return;
  }

  const ticketFiles = files.map((f) => resolve(TICKETS_DIR, f));

  // Scan first to decide if backup is needed
  const toUpdate: Array<{ file: string; ticket: TicketData; fixCount: number }> = [];

  for (const file of ticketFiles) {
    let ticket: TicketData;
    try {
      ticket = JSON.parse(readFileSync(file, "utf-8")) as TicketData;
    } catch {
      console.warn(`Skipping ${basename(file)}: JSON parse error`);
      continue;
    }

    const comments = ticket.comments ?? [];
    const missing = comments.filter((c) => !c.id);
    if (missing.length > 0) {
      toUpdate.push({ file, ticket, fixCount: missing.length });
    }
  }

  if (toUpdate.length === 0) {
    console.log("All comments already have IDs. Nothing to do.");
    return;
  }

  console.log(`Found ${toUpdate.length} ticket(s) with comments missing IDs.`);

  if (!DRY_RUN) {
    const backupDir = backupTickets(ticketFiles);
    console.log(`Backed up ${ticketFiles.length} ticket(s) to ${backupDir}`);
  }

  let totalFixed = 0;

  for (const { file, ticket, fixCount } of toUpdate) {
    const comments = ticket.comments ?? [];
    const updated = comments.map((c) => (c.id ? c : { ...c, id: randomUUID() }));
    totalFixed += fixCount;

    console.log(`  ${basename(file)}: adding IDs to ${fixCount} comment(s)`);

    if (!DRY_RUN) {
      const updatedTicket = { ...ticket, comments: updated };
      writeFileSync(file, JSON.stringify(updatedTicket, null, 2));
    }
  }

  if (DRY_RUN) {
    console.log(`\n[dry-run] Would fix ${totalFixed} comment(s) across ${toUpdate.length} ticket(s). No files written.`);
  } else {
    console.log(`\nDone. Fixed ${totalFixed} comment(s) across ${toUpdate.length} ticket(s).`);
  }
}

main();
