#!/usr/bin/env node
/**
 * PA-1210 Phase 4.6: Backfill script for UAT-named attachments.
 *
 * Scans all tickets, retypes any doc_refs whose path matches the UAT heuristic
 * from `attachment` → `uat`. Dry-run by default; --apply to commit.
 *
 * Heuristic: type === "attachment" AND (path ends with "-uat.md" OR contains "uat-test-plan")
 *
 * Usage:
 *   node scripts/dev/backfill-uat-doc-refs.ts          # dry-run
 *   node scripts/dev/backfill-uat-doc-refs.ts --apply  # commit changes
 *   node scripts/dev/backfill-uat-doc-refs.ts --apply --project pa  # filter by project
 *
 * Idempotent: safe to re-run with --apply (skips refs already typed as "uat").
 */

import { TicketStore } from "../../src/lib/tickets/store.js";
import type { Ticket } from "../../src/lib/tickets/types.js";

const APPLY = process.argv.includes("--apply");
const PROJECT_FILTER = (() => {
  const idx = process.argv.indexOf("--project");
  return idx !== -1 ? process.argv[idx + 1] : undefined;
})();

/** UAT heuristic: path ends with -uat.md OR contains uat-test-plan */
function isUatPath(path: string): boolean {
  return path.endsWith("-uat.md") || path.includes("uat-test-plan");
}

/** Normalize type to standard form (empty/undefined → "attachment") */
function normalizeDocRefType(type: string | undefined): string {
  return type && type.trim() !== "" ? type.trim() : "attachment";
}

interface ChangeRecord {
  ticketId: string;
  path: string;
  fromType: string;
  toType: string;
}

function main(): void {
  const store = new TicketStore();
  const allTickets = store.list();

  const tickets: Ticket[] = PROJECT_FILTER
    ? allTickets.filter((t: Ticket) => t.project === PROJECT_FILTER)
    : allTickets;

  const changes: ChangeRecord[] = [];
  let skippedAlreadyUat = 0;
  let skippedNoMatch = 0;
  let skippedNotAttachment = 0;

  for (const ticket of tickets) {
    for (const ref of ticket.doc_refs ?? []) {
      const type = normalizeDocRefType(ref.type);

      // Skip already-typed as uat (idempotence)
      if (type === "uat") {
        skippedAlreadyUat++;
        continue;
      }

      // Skip non-attachment types
      if (type !== "attachment") {
        skippedNotAttachment++;
        continue;
      }

      // Check UAT heuristic
      if (!isUatPath(ref.path)) {
        skippedNoMatch++;
        continue;
      }

      changes.push({
        ticketId: ticket.id,
        path: ref.path,
        fromType: type,
        toType: "uat",
      });
    }
  }

  // Print dry-run preview
  if (changes.length === 0) {
    console.log("No UAT-named attachment doc_refs found.");
    console.log(`  (skipped already-uat: ${skippedAlreadyUat}, not-attachment: ${skippedNotAttachment}, no-path-match: ${skippedNoMatch})`);
    process.exit(0);
  }

  console.log(`Found ${changes.length} doc_ref(s) to re-type:\n`);
  for (const c of changes) {
    console.log(`  ${c.ticketId}  ${c.path}`);
  }

  if (!APPLY) {
    console.log("\n[dry-run] No changes made. Run with --apply to commit.");
    process.exit(0);
  }

  // Apply changes
  console.log("\n[apply] Updating doc_ref types...");
  let applied = 0;
  let errors = 0;

  for (const c of changes) {
    try {
      store.update(
        c.ticketId,
        { add_doc_ref: { type: "uat", path: c.path, primary: false } },
        "backfill-uat-doc-refs"
      );
      applied++;
      console.log(`  [ok] ${c.ticketId}: ${c.path} → uat`);
    } catch (err) {
      errors++;
      console.error(`  [err] ${c.ticketId}: ${c.path} — ${err}`);
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Applied:  ${applied}`);
  console.log(`  Errors:   ${errors}`);
  console.log(`  Skipped:  already-uat=${skippedAlreadyUat} not-attachment=${skippedNotAttachment} no-path-match=${skippedNoMatch}`);

  process.exit(errors > 0 ? 1 : 0);
}

main();