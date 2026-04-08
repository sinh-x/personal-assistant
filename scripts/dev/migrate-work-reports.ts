#!/usr/bin/env node
/**
 * Migration script: batch-process work-report tickets stuck in idea status.
 *
 * For each ticket with type=work-report and status=idea:
 *   1. Check if summary has WHAT/STATUS/OUTPUTS fields (template compliance)
 *   2. If missing, prepend template header to existing summary
 *   3. Close the ticket as done (these are historical/migrated items)
 *   4. Log results
 *
 * Usage:
 *   npx tsx scripts/migrate-work-reports.ts [--dry-run]
 *
 * Flags:
 *   --dry-run  Print what would change without modifying any files
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

const TICKETS_DIR = resolve(homedir(), "Documents/ai-usage/tickets");
const DRY_RUN = process.argv.includes("--dry-run");

interface Ticket {
  id: string;
  project: string;
  type: string;
  status: string;
  summary: string;
  title: string;
  updatedAt: string;
  resolvedAt?: string | null;
  [key: string]: unknown;
}

/** Check if a summary already has the WHAT/STATUS/OUTPUTS template fields */
function hasTemplate(summary: string): boolean {
  return (
    /\bWHAT\s*:/i.test(summary) &&
    /\bSTATUS\s*:/i.test(summary) &&
    /\bOUTPUTS\s*:/i.test(summary)
  );
}

/** Build a template-compliant summary from raw content */
function applyTemplate(rawSummary: string): string {
  // Truncate the raw summary for the WHAT field (first 200 chars)
  const what = rawSummary.replace(/\n/g, " ").slice(0, 200).trim();
  return `WHAT: ${what}\nSTATUS: success\nOUTPUTS: (migrated from inbox — see ticket history for details)`;
}

function main() {
  const files = readdirSync(TICKETS_DIR).filter(
    (f) => f.match(/^[A-Z]+-\d+\.json$/) != null
  );

  let totalFound = 0;
  let totalTemplateApplied = 0;
  let totalAlreadyCompliant = 0;
  let totalClosed = 0;
  let totalErrors = 0;

  const results: Array<{ id: string; action: string; error?: string }> = [];

  for (const file of files) {
    const filePath = resolve(TICKETS_DIR, file);
    let ticket: Ticket;
    try {
      ticket = JSON.parse(readFileSync(filePath, "utf-8")) as Ticket;
    } catch {
      continue;
    }

    if (ticket.type !== "work-report" || ticket.status !== "idea") {
      continue;
    }

    totalFound++;

    let newSummary = ticket.summary ?? "";
    let templateApplied = false;

    // Check/apply summary template
    if (!hasTemplate(newSummary)) {
      newSummary = applyTemplate(newSummary);
      templateApplied = true;
      totalTemplateApplied++;
    } else {
      totalAlreadyCompliant++;
    }

    // Close as done
    const now = new Date().toISOString();
    const updated: Ticket = {
      ...ticket,
      summary: newSummary,
      status: "done",
      updatedAt: now,
      resolvedAt: now,
    };

    if (DRY_RUN) {
      results.push({
        id: ticket.id,
        action: templateApplied
          ? "would apply template + close"
          : "would close (template already present)",
      });
    } else {
      try {
        writeFileSync(filePath, JSON.stringify(updated, null, 2) + "\n", "utf-8");
        totalClosed++;
        results.push({
          id: ticket.id,
          action: templateApplied
            ? "template applied + closed"
            : "closed (template already present)",
        });
      } catch (err) {
        totalErrors++;
        results.push({
          id: ticket.id,
          action: "error",
          error: String(err),
        });
      }
    }
  }

  // Print summary
  const mode = DRY_RUN ? "[DRY RUN] " : "";
  console.log(`\n${mode}Migration Results`);
  console.log("=================");
  console.log(`Total work-report tickets in idea status: ${totalFound}`);
  console.log(`Template applied (WHAT/STATUS/OUTPUTS added): ${totalTemplateApplied}`);
  console.log(`Already template-compliant: ${totalAlreadyCompliant}`);
  if (!DRY_RUN) {
    console.log(`Closed as done: ${totalClosed}`);
    console.log(`Errors: ${totalErrors}`);
  }

  // Print details for first 10
  if (results.length > 0) {
    console.log(`\nSample (first 10 of ${results.length}):`);
    for (const r of results.slice(0, 10)) {
      const errStr = r.error ? ` — ${r.error}` : "";
      console.log(`  ${r.id}: ${r.action}${errStr}`);
    }
    if (results.length > 10) {
      console.log(`  ... and ${results.length - 10} more`);
    }
  }

  if (DRY_RUN) {
    console.log("\n(Dry run — no files modified. Remove --dry-run to apply.)");
  } else {
    console.log(`\nMigration complete.`);
    if (totalErrors > 0) {
      console.error(`\nWARNING: ${totalErrors} tickets failed to update.`);
      process.exit(1);
    }
  }
}

main();
