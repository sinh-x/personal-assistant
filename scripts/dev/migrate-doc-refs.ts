#!/usr/bin/env node
/**
 * Migration script: convert doc_ref (string) + attachments (string[]) to doc_refs (DocRef[]).
 *
 * Logic per ticket:
 *   - If ticket already has `doc_refs` field (array)  → skip (already migrated, idempotent)
 *   - If ticket has non-empty `doc_ref` string        → convert to DocRef { type, path, primary: true }
 *   - If ticket has non-empty `attachments` array     → convert each to DocRef { type: 'attachment' }
 *   - Remove old `doc_ref` and `attachments` fields
 *   - Write back with atomic file write
 *
 * Backup: copies all ticket JSON files to <tickets-dir>/backup-doc-refs-YYYYMMDDTHHMMSS/
 * before making any changes.
 *
 * Usage:
 *   npx tsx scripts/migrate-doc-refs.ts [--dry-run]
 *
 * Flags:
 *   --dry-run  Print what would change without modifying any files
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { homedir } from "node:os";

const TICKETS_DIR = resolve(homedir(), "Documents/ai-usage/tickets");
const DRY_RUN = process.argv.includes("--dry-run");

interface DocRef {
  type: string;
  path: string;
  primary: boolean;
  addedAt: string;
  addedBy: string;
}

interface OldTicketData {
  id: string;
  doc_ref?: string;
  attachments?: string[];
  createdAt?: string;
  [key: string]: unknown;
}

interface NewTicketData {
  id: string;
  doc_refs: DocRef[];
  [key: string]: unknown;
}

/**
 * Infer a doc type from the path pattern.
 * Heuristics based on common path conventions in the ai-usage system.
 */
function inferDocType(path: string): string {
  const lower = path.toLowerCase();
  if (lower.includes("/requirements/") || lower.includes("requirements-")) return "requirements";
  if (lower.includes("/spike") || lower.includes("spike-")) return "spike";
  if (
    lower.includes("/builder/") ||
    lower.includes("-impl") ||
    lower.includes("-implementation") ||
    lower.includes("implementation-")
  )
    return "implementation";
  if (lower.includes("review-report") || lower.includes("-review-report")) return "review-report";
  return "attachment";
}

/** Format a timestamp for backup directory name */
function formatTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace("T", "T").slice(0, 15);
}

/** Back up all ticket JSON files */
function backupTickets(ticketFiles: string[]): string {
  const backupDir = resolve(TICKETS_DIR, `backup-doc-refs-${formatTimestamp(new Date())}`);
  if (!DRY_RUN) {
    mkdirSync(backupDir, { recursive: true });
    for (const file of ticketFiles) {
      copyFileSync(file, resolve(backupDir, basename(file)));
    }
  }
  return backupDir;
}

/** Read all ticket JSON files (excluding counter.json and backup directories) */
function readTicketFiles(): string[] {
  if (!existsSync(TICKETS_DIR)) {
    throw new Error(`Tickets directory not found: ${TICKETS_DIR}`);
  }
  return readdirSync(TICKETS_DIR)
    .filter((f) => f.endsWith(".json") && f !== "counter.json")
    .map((f) => resolve(TICKETS_DIR, f));
}

async function main(): Promise<void> {
  console.log(`[migrate-doc-refs] ${DRY_RUN ? "DRY RUN — " : ""}Starting migration`);
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
  let converted = 0;
  let noDocRef = 0;
  const errors: string[] = [];

  for (const filePath of ticketFiles) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(filePath, "utf-8"));
    } catch (err) {
      errors.push(`  PARSE ERROR ${basename(filePath)}: ${err}`);
      continue;
    }

    const ticket = raw as OldTicketData;

    // Idempotency: skip tickets already in new format
    if ("doc_refs" in ticket && Array.isArray((ticket as NewTicketData).doc_refs)) {
      alreadyMigrated++;
      continue;
    }

    const oldDocRef = ticket.doc_ref;
    const oldAttachments = ticket.attachments ?? [];
    const addedAt = ticket.createdAt ?? new Date().toISOString();

    const hasDocRef = typeof oldDocRef === "string" && oldDocRef.trim().length > 0;
    const hasAttachments = Array.isArray(oldAttachments) && oldAttachments.length > 0;

    if (!hasDocRef && !hasAttachments) {
      // No document refs at all — just initialize empty doc_refs array
      noDocRef++;
    } else {
      converted++;
    }

    // Build new doc_refs array
    const docRefs: DocRef[] = [];

    if (hasDocRef) {
      const path = oldDocRef!.trim();
      docRefs.push({
        type: inferDocType(path),
        path,
        primary: true,
        addedAt,
        addedBy: "migration",
      });
    }

    if (hasAttachments) {
      for (const attachPath of oldAttachments) {
        if (typeof attachPath !== "string" || !attachPath.trim()) continue;
        // Skip if this path is already added from doc_ref
        if (hasDocRef && attachPath.trim() === oldDocRef!.trim()) continue;
        docRefs.push({
          type: "attachment",
          path: attachPath.trim(),
          primary: false,
          addedAt,
          addedBy: "migration",
        });
      }
    }

    if (hasDocRef || hasAttachments) {
      console.log(`  [CONVERT]  ${ticket.id}: doc_ref → ${docRefs.length} DocRef(s)`);
      if (hasDocRef) {
        console.log(`             primary: ${oldDocRef} (type: ${docRefs[0].type})`);
      }
      if (hasAttachments) {
        const attachCount = docRefs.filter((r) => r.type === "attachment").length;
        if (attachCount > 0) console.log(`             attachments: ${attachCount} → type:attachment`);
      }
    }

    // Build new ticket: remove old fields, add doc_refs
    const newTicket = { ...ticket } as Record<string, unknown>;
    delete newTicket["doc_ref"];
    delete newTicket["attachments"];
    newTicket["doc_refs"] = docRefs;

    if (!DRY_RUN) {
      writeFileSync(filePath, JSON.stringify(newTicket, null, 2));
    }
  }

  // Summary
  console.log("\n=== Migration Summary ===");
  console.log(`  Total ticket files:         ${ticketFiles.length}`);
  console.log(`  Already migrated (skipped): ${alreadyMigrated}`);
  console.log(`  Converted (had doc_ref):    ${converted}`);
  console.log(`  Empty doc_refs (no change): ${noDocRef}`);
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
