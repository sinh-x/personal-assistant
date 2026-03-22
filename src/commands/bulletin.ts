import { Command } from "commander";
import { BulletinStore } from "../lib/bulletins/index.js";
import type { BulletinBlock } from "../lib/bulletins/index.js";

export function createBulletinCommand(): Command {
  const cmd = new Command("bulletin").description("Manage bulletins (deploy-time blockers)");

  // ── create ─────────────────────────────────────────────────────────────────

  cmd
    .command("create")
    .description("Create a new active bulletin")
    .requiredOption("--title <title>", "Bulletin title")
    .requiredOption(
      "--block <teams>",
      'Teams to block: "all" or comma-separated team names (e.g. "daily,builder")'
    )
    .option(
      "--except <teams>",
      "Comma-separated list of teams exempt from this bulletin",
      ""
    )
    .option("--message <text>", "Bulletin body message", "")
    .action(
      (opts: { title: string; block: string; except: string; message: string }) => {
        const block: BulletinBlock =
          opts.block === "all"
            ? "all"
            : opts.block.split(",").map((t) => t.trim()).filter(Boolean);
        const except = opts.except
          ? opts.except.split(",").map((t) => t.trim()).filter(Boolean)
          : [];

        const store = new BulletinStore();
        const bulletin = store.create({ title: opts.title, block, except, body: opts.message });

        console.log(`Created bulletin: ${bulletin.id}`);
        console.log(`  Title:   ${bulletin.title}`);
        console.log(`  Block:   ${JSON.stringify(bulletin.block)}`);
        if (bulletin.except.length > 0) {
          console.log(`  Exempt:  ${bulletin.except.join(", ")}`);
        }
        console.log(`  Created: ${bulletin.created}`);
      }
    );

  // ── list ───────────────────────────────────────────────────────────────────

  cmd
    .command("list")
    .description("List all active bulletins")
    .action(() => {
      const store = new BulletinStore();
      const bulletins = store.readActive();

      if (bulletins.length === 0) {
        console.log("No active bulletins.");
        return;
      }

      console.log(`${bulletins.length} active bulletin(s):\n`);
      for (const b of bulletins) {
        const blockStr = b.block === "all" ? "ALL TEAMS" : b.block.join(", ");
        console.log(`  [${b.id}] ${b.title}`);
        console.log(`    Block:   ${blockStr}`);
        if (b.except.length > 0) {
          console.log(`    Exempt:  ${b.except.join(", ")}`);
        }
        console.log(`    Created: ${b.created}`);
        if (b.body) {
          console.log(`    Message: ${b.body.split("\n")[0]}`);
        }
        console.log();
      }
    });

  // ── resolve ────────────────────────────────────────────────────────────────

  cmd
    .command("resolve")
    .description("Resolve (deactivate) a bulletin by ID")
    .argument("<id>", "Bulletin ID (e.g. B-001)")
    .action((id: string) => {
      const store = new BulletinStore();
      const ok = store.resolve(id);
      if (!ok) {
        console.error(`Bulletin not found in active: ${id}`);
        process.exit(1);
      }
      console.log(`Resolved bulletin: ${id}`);
    });

  return cmd;
}
