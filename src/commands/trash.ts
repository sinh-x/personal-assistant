import { Command } from "commander";
import { TrashStore } from "../lib/trash/index.js";
import type { TrashFileType, TrashStatus } from "../lib/trash/index.js";

const FILE_TYPES: TrashFileType[] = ["skill", "team", "objective", "mode", "other"];

function formatRow(
  id: string,
  status: string,
  type: string,
  actor: string,
  originalPath: string
): string {
  return (
    id.padEnd(8) +
    status.padEnd(11) +
    type.padEnd(12) +
    actor.padEnd(25) +
    originalPath
  );
}

export function createTrashCommand(): Command {
  const cmd = new Command("trash").description(
    "Soft-delete PA project files (skills, teams, objectives)"
  );

  // ── move ──────────────────────────────────────────────────────────────────

  cmd
    .command("move")
    .description("Soft-delete a file to trash")
    .argument("<path>", "File path to trash")
    .requiredOption("--reason <text>", "Why this file is being trashed")
    .option("--actor <name>", "Who is trashing it", "cli-user")
    .option(
      "--type <type>",
      "File type (skill|team|objective|mode|other)",
      "other"
    )
    .action(
      (
        path: string,
        opts: { reason: string; actor: string; type: string }
      ) => {
        if (!FILE_TYPES.includes(opts.type as TrashFileType)) {
          console.error(
            `Error: Invalid file type "${opts.type}". Must be one of: ${FILE_TYPES.join(", ")}`
          );
          process.exit(1);
        }

        const store = new TrashStore();
        try {
          const entry = store.move({
            path,
            reason: opts.reason,
            actor: opts.actor,
            fileType: opts.type as TrashFileType,
          });
          console.log(`Trashed: ${entry.id}`);
          console.log(`  From: ${entry.originalPath}`);
          console.log(`  To:   trash/files/${entry.trashPath}`);
          console.log(`  Reason: ${entry.reason}`);
        } catch (err) {
          console.error(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      }
    );

  // ── list ──────────────────────────────────────────────────────────────────

  cmd
    .command("list")
    .description("List trashed items")
    .option(
      "--status <status>",
      "Filter by status (trashed|restored|purged)"
    )
    .option("--type <type>", "Filter by file type")
    .option("--search <text>", "Free-text search on ID, path, reason, actor")
    .action(
      (opts: { status?: string; type?: string; search?: string }) => {
        const store = new TrashStore();
        const entries = store.list({
          status: opts.status as TrashStatus | undefined,
          fileType: opts.type as TrashFileType | undefined,
          search: opts.search,
        });

        if (entries.length === 0) {
          console.log("No trash entries found.");
          return;
        }

        console.log(
          formatRow("ID", "STATUS", "TYPE", "ACTOR", "ORIGINAL PATH")
        );
        console.log("-".repeat(90));
        for (const e of entries) {
          console.log(
            formatRow(e.id, e.status, e.fileType, e.actor, e.originalPath)
          );
        }
        console.log(`\n${entries.length} entry(ies)`);
      }
    );

  // ── show ──────────────────────────────────────────────────────────────────

  cmd
    .command("show")
    .description("Show full details for a trash entry")
    .argument("<id>", "Trash ID (e.g. T-001)")
    .action((id: string) => {
      const store = new TrashStore();
      const entry = store.get(id);
      if (!entry) {
        console.error(`Trash entry not found: ${id}`);
        process.exit(1);
      }
      console.log(JSON.stringify(entry, null, 2));
    });

  // ── restore ───────────────────────────────────────────────────────────────

  cmd
    .command("restore")
    .description("Restore a trashed file to its original path")
    .argument("<id>", "Trash ID (e.g. T-001)")
    .option("--force", "Overwrite if original path already exists")
    .option("--actor <name>", "Who is restoring", "cli-user")
    .action((id: string, opts: { force?: boolean; actor: string }) => {
      const store = new TrashStore();
      try {
        const entry = store.restore(id, {
          force: opts.force,
          actor: opts.actor,
        });
        console.log(`Restored: ${entry.id}`);
        console.log(`  To: ${entry.originalPath}`);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ── purge ─────────────────────────────────────────────────────────────────

  cmd
    .command("purge")
    .description("Permanently delete trashed items older than N days")
    .option("--days <n>", "Retention period in days", "30")
    .option("--dry-run", "Show what would be purged without deleting")
    .option("--actor <name>", "Who is purging", "cli-user")
    .action((opts: { days: string; dryRun?: boolean; actor: string }) => {
      const days = parseInt(opts.days, 10);
      if (isNaN(days) || days < 0) {
        console.error(`Error: Invalid days value "${opts.days}"`);
        process.exit(1);
      }

      const store = new TrashStore();
      const purged = store.purge({
        days,
        dryRun: opts.dryRun,
        actor: opts.actor,
      });

      if (purged.length === 0) {
        console.log("Nothing to purge.");
        return;
      }

      const verb = opts.dryRun ? "Would purge" : "Purged";
      for (const e of purged) {
        console.log(`${verb}: ${e.id} — ${e.originalPath}`);
      }
      console.log(`\n${purged.length} entry(ies) ${opts.dryRun ? "would be purged" : "purged"}`);
    });

  return cmd;
}
