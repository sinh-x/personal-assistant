#!/usr/bin/env node
/**
 * Migration script: prefix bare agent assignee names with team context.
 *
 * Logic per ticket:
 *   - If assignee is empty, whitelisted (sinh), or already contains "/"  → skip
 *   - If assignee is a valid team name (e.g., "builder")                 → skip (team-level assignment)
 *   - If assignee is a bare agent name (e.g., "team-manager")            → attempt to determine team:
 *     - Look at audit log for the most recent actor that set this assignee
 *     - Look at ticket project mapping to infer team
 *     - If deterministic, prefix with team name
 *     - If ambiguous, log for manual review
 *
 * Backup: copies all ticket JSON files to <tickets-dir>/backup-assignee-YYYYMMDDTHHMMSS/
 * before making any changes.
 *
 * Usage:
 *   npx tsx scripts/migrate-assignee-format.ts [--dry-run]
 *
 * Flags:
 *   --dry-run  Print what would change without modifying any files
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { homedir } from "node:os";
import yaml from "js-yaml";

const TICKETS_DIR = resolve(homedir(), "Documents/ai-usage/tickets");
const TEAMS_DIR = resolve(process.cwd(), "teams");
const DRY_RUN = process.argv.includes("--dry-run");

const BARE_NAME_WHITELIST = ["sinh"];

interface TicketData {
  id: string;
  project?: string;
  assignee: string;
  from?: string;
  to?: string;
  [key: string]: unknown;
}

interface AuditEntry {
  ticket_id: string;
  action: string;
  actor: string;
  timestamp: string;
  changes: Record<string, [unknown, unknown]>;
}

/** Read team names from teams/*.yaml */
function getValidTeamNames(): Set<string> {
  const names = new Set<string>();
  try {
    const files = readdirSync(TEAMS_DIR).filter((f) => f.endsWith(".yaml"));
    for (const file of files) {
      try {
        const content = readFileSync(resolve(TEAMS_DIR, file), "utf-8");
        const raw = yaml.load(content) as Record<string, unknown>;
        if (typeof raw["name"] === "string" && raw["name"]) {
          names.add(raw["name"]);
        }
      } catch {
        // skip
      }
    }
  } catch {
    // teams dir not accessible
  }
  return names;
}

/** Format a timestamp for backup directory name */
function formatTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace("T", "T").slice(0, 15);
}

/** Back up all ticket JSON files */
function backupTickets(ticketFiles: string[]): string {
  const backupDir = resolve(TICKETS_DIR, `backup-assignee-${formatTimestamp(new Date())}`);
  if (!DRY_RUN) {
    mkdirSync(backupDir, { recursive: true });
    for (const file of ticketFiles) {
      copyFileSync(file, resolve(backupDir, basename(file)));
    }
  }
  return backupDir;
}

/** Read all ticket JSON files */
function readTicketFiles(): string[] {
  if (!existsSync(TICKETS_DIR)) {
    throw new Error(`Tickets directory not found: ${TICKETS_DIR}`);
  }
  return readdirSync(TICKETS_DIR)
    .filter((f) => f.endsWith(".json") && f !== "counter.json")
    .map((f) => resolve(TICKETS_DIR, f));
}

/** Read audit log entries */
function readAuditLog(): AuditEntry[] {
  const auditPath = resolve(TICKETS_DIR, "audit.jsonl");
  if (!existsSync(auditPath)) return [];
  return readFileSync(auditPath, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as AuditEntry);
}

/** Try to determine the team for a bare agent assignee from audit history */
function inferTeamFromAudit(
  ticketId: string,
  auditEntries: AuditEntry[],
  validTeams: Set<string>,
): string | undefined {
  // Find audit entries for this ticket that changed assignee
  const assigneeChanges = auditEntries
    .filter((e) => e.ticket_id === ticketId && e.changes?.["assignee"])
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp)); // most recent first

  for (const entry of assigneeChanges) {
    // Check if the actor has a team prefix
    if (entry.actor.includes("/")) {
      const teamPrefix = entry.actor.split("/")[0];
      if (validTeams.has(teamPrefix)) return teamPrefix;
    }
    // Check if the actor IS a team name
    if (validTeams.has(entry.actor)) return entry.actor;
  }

  return undefined;
}

/** Try to determine team from ticket `from` or `to` fields */
function inferTeamFromTicketFields(ticket: TicketData, validTeams: Set<string>): string | undefined {
  // Check `to` field — this is the destination team
  if (ticket.to && validTeams.has(ticket.to)) return ticket.to;
  // Check `from` field as fallback
  if (ticket.from && validTeams.has(ticket.from)) return ticket.from;
  return undefined;
}

async function main(): Promise<void> {
  console.log(`[migrate-assignee-format] ${DRY_RUN ? "DRY RUN — " : ""}Starting migration`);
  console.log(`Tickets directory: ${TICKETS_DIR}`);
  console.log(`Teams directory: ${TEAMS_DIR}`);

  const validTeams = getValidTeamNames();
  console.log(`Valid teams: ${[...validTeams].sort().join(", ")}\n`);

  const ticketFiles = readTicketFiles();
  console.log(`Found ${ticketFiles.length} ticket file(s)`);

  if (ticketFiles.length === 0) {
    console.log("Nothing to migrate.");
    return;
  }

  const auditEntries = readAuditLog();
  console.log(`Audit log: ${auditEntries.length} entries\n`);

  // Step 1: Backup
  if (!DRY_RUN) {
    const backupDir = backupTickets(ticketFiles);
    console.log(`Backup created: ${backupDir}\n`);
  } else {
    console.log("(dry-run: backup would be created)\n");
  }

  // Step 2: Analyze and transform
  let prefixed = 0;
  let skipped = 0;
  let ambiguous = 0;
  const ambiguousList: string[] = [];
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
    const assignee = ticket.assignee;

    // Skip conditions
    if (!assignee) { skipped++; continue; }
    if (BARE_NAME_WHITELIST.includes(assignee)) { skipped++; continue; }
    if (assignee.includes("/")) { skipped++; continue; } // already prefixed
    if (validTeams.has(assignee)) { skipped++; continue; } // team-level assignment

    // Bare agent name — try to infer team
    let team = inferTeamFromAudit(ticket.id, auditEntries, validTeams);
    if (!team) {
      team = inferTeamFromTicketFields(ticket, validTeams);
    }

    if (team) {
      const newAssignee = `${team}/${assignee}`;
      console.log(`  [PREFIX]  ${ticket.id}: "${assignee}" → "${newAssignee}"`);

      if (!DRY_RUN) {
        ticket.assignee = newAssignee;
        writeFileSync(filePath, JSON.stringify(ticket, null, 2));
      }
      prefixed++;
    } else {
      console.log(`  [AMBIG]   ${ticket.id}: "${assignee}" — cannot determine team (manual review needed)`);
      ambiguousList.push(`${ticket.id} (assignee: "${assignee}")`);
      ambiguous++;
    }
  }

  // Step 3: Summary
  console.log(`\n--- Migration Summary ---`);
  console.log(`  Total files:    ${ticketFiles.length}`);
  console.log(`  Prefixed:       ${prefixed}  (bare agent → team/agent)`);
  console.log(`  Skipped:        ${skipped}   (already correct, whitelisted, or team-level)`);
  console.log(`  Ambiguous:      ${ambiguous}  (need manual review)`);
  console.log(`  Errors:         ${errors.length}`);

  if (ambiguousList.length > 0) {
    console.log("\nAmbiguous tickets (manual review needed):");
    for (const item of ambiguousList) {
      console.log(`  - ${item}`);
    }
    console.log("\nTo fix manually:");
    console.log('  pa ticket update <id> --assignee <team>/<agent>');
  }

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
