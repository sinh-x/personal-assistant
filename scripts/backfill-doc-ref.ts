#!/usr/bin/env node
/**
 * Retroactive doc-ref sweep script (PA-912 Phase 4 / F9).
 *
 * Scans all active tickets for artifact path patterns in comments and summaries.
 * If exactly one unique path is found and doc_ref is empty, sets it automatically.
 * If multiple paths are found, logs them for manual review.
 *
 * Usage:
 *   npx tsx scripts/backfill-doc-ref.ts [--dry-run]
 *
 * Flags:
 *   --dry-run  Show what would change without modifying any files
 */

import { TicketStore } from "../src/lib/tickets/store.js";
import { ACTIVE_STATUSES } from "../src/lib/tickets/types.js";

const DRY_RUN = process.argv.includes("--dry-run");

/** Regex patterns for artifact paths (reset lastIndex before each use) */
const ARTIFACT_PATTERNS: RegExp[] = [
  /agent-teams\/[^\s/]+\/artifacts\/[^\s"')\]]+\.md/g,
  /deployments\/[^\s/]+\/[^\s"')\]]+\.md/g,
];

/** Extract all unique artifact path candidates from a block of text. */
function extractPaths(text: string): Set<string> {
  const found = new Set<string>();
  for (const pattern of ARTIFACT_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      found.add(match[0]);
    }
  }
  return found;
}

function main(): void {
  const store = new TicketStore();
  const activeStatusSet = new Set(ACTIVE_STATUSES);

  const activeTickets = store.list().filter((t) => activeStatusSet.has(t.status));

  let alreadySet = 0;
  let updated = 0;
  let ambiguous = 0;
  let noCandidates = 0;

  for (const ticket of activeTickets) {
    if (ticket.doc_ref && ticket.doc_ref.trim()) {
      alreadySet++;
      continue;
    }

    // Collect candidate paths from summary + all comment bodies
    const allPaths = new Set<string>();
    for (const p of extractPaths(ticket.summary)) allPaths.add(p);
    for (const comment of ticket.comments) {
      for (const p of extractPaths(comment.content)) allPaths.add(p);
    }

    if (allPaths.size === 0) {
      noCandidates++;
      console.log(`  [no-candidate]  ${ticket.id}: ${ticket.title}`);
    } else if (allPaths.size === 1) {
      const [path] = allPaths;
      updated++;
      console.log(`  [update]  ${ticket.id}: ${ticket.title}`);
      console.log(`            → doc_ref: ${path}`);
      if (!DRY_RUN) {
        store.update(ticket.id, { doc_ref: path }, "backfill-doc-ref");
      }
    } else {
      ambiguous++;
      console.log(`  [ambiguous]  ${ticket.id}: ${ticket.title}`);
      console.log(`               Candidates (needs manual review):`);
      for (const p of allPaths) {
        console.log(`                 - ${p}`);
      }
    }
  }

  console.log("\n=== Backfill doc-ref Summary ===");
  console.log(`  Total active tickets scanned:    ${activeTickets.length}`);
  console.log(`  Already have doc_ref (skipped):  ${alreadySet}`);
  console.log(`  Updated (path found and set):    ${updated}`);
  console.log(`  Ambiguous (multiple candidates): ${ambiguous}`);
  console.log(`  No candidates:                   ${noCandidates}`);

  if (DRY_RUN) {
    console.log("\n[dry-run] No files written.");
  }
}

main();
