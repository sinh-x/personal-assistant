import { Command } from "commander";
import { appendRegistryEvent, getDeploymentEvents, readRegistry, computeDeploymentStatuses } from "../lib/registry.js";
import { localISOTimestamp } from "../lib/time.js";
import type { Rating, RegistryEvent } from "../lib/types.js";
import { getRegistryPath } from "../lib/paths.js";
import { execSync } from "node:child_process";
import { readdirSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

const VALID_STATUSES = ["success", "partial", "failed"] as const;
type CompletionStatus = (typeof VALID_STATUSES)[number];

const VALID_RATING_SOURCES = ["agent", "system", "user"] as const;
type RatingSource = (typeof VALID_RATING_SOURCES)[number];

export function createRegistryCommand(): Command {
  const cmd = new Command("registry").description("Manage deployment registry");

  cmd
    .command("complete <deploy-id>")
    .description("Write a completion marker for a deployment")
    .requiredOption(
      "--status <status>",
      "Completion status (success|partial|failed)"
    )
    .requiredOption("--summary <text>", "One-line summary of what was done")
    .option("--log-file <path>", "Session log file path (optional)")
    .option("--rating-source <source>", "Rating source (agent|system|user)")
    .option("--rating-overall <number>", "Overall rating (0-5)", parseFloat)
    .option("--rating-productivity <number>", "Productivity rating (0-5)", parseFloat)
    .option("--rating-quality <number>", "Quality rating (0-5)", parseFloat)
    .option("--rating-efficiency <number>", "Efficiency rating (0-5)", parseFloat)
    .option("--rating-insight <number>", "Insight rating (0-5)", parseFloat)
    .action(
      (
        deployId: string,
        opts: {
          status: string;
          summary: string;
          logFile?: string;
          ratingSource?: string;
          ratingOverall?: number;
          ratingProductivity?: number;
          ratingQuality?: number;
          ratingEfficiency?: number;
          ratingInsight?: number;
        }
      ) => {
        // Validate status
        if (!VALID_STATUSES.includes(opts.status as CompletionStatus)) {
          console.error(
            `Error: Invalid status "${opts.status}". Must be one of: success, partial, failed`
          );
          process.exit(1);
        }

        // Validate rating source if provided
        if (
          opts.ratingSource &&
          !VALID_RATING_SOURCES.includes(opts.ratingSource as RatingSource)
        ) {
          console.error(
            `Error: Invalid rating source "${opts.ratingSource}". Must be one of: agent, system, user`
          );
          process.exit(1);
        }

        // Validate rating values are in range
        const ratingValues = [
          opts.ratingOverall,
          opts.ratingProductivity,
          opts.ratingQuality,
          opts.ratingEfficiency,
          opts.ratingInsight,
        ];
        for (const val of ratingValues) {
          if (val !== undefined && (val < 0 || val > 5)) {
            console.error(
              `Error: Rating values must be between 0 and 5. Got: ${val}`
            );
            process.exit(1);
          }
        }

        // Validate deployment exists (has a started event)
        const events = getDeploymentEvents(deployId);
        const started = events.find((e) => e.event === "started");
        if (!started) {
          console.error(
            `Error: Deployment "${deployId}" not found in registry (no started event).`
          );
          process.exit(1);
        }

        // Warn if no rating flags provided
        if (!opts.ratingSource && opts.ratingOverall === undefined) {
          console.error(
            "Warning: No rating provided. Consider adding --rating-overall for analytics."
          );
        }

        // Build rating object if any rating options are provided
        let rating: Rating | undefined;
        if (opts.ratingSource || opts.ratingOverall !== undefined) {
          rating = {
            source: (opts.ratingSource as RatingSource) ?? "agent",
            overall: opts.ratingOverall ?? 0,
            ...(opts.ratingProductivity !== undefined && {
              productivity: opts.ratingProductivity,
            }),
            ...(opts.ratingQuality !== undefined && {
              quality: opts.ratingQuality,
            }),
            ...(opts.ratingEfficiency !== undefined && {
              efficiency: opts.ratingEfficiency,
            }),
            ...(opts.ratingInsight !== undefined && {
              insight: opts.ratingInsight,
            }),
          };
        }

        const event: RegistryEvent = {
          deployment_id: deployId,
          team: started.team,
          event: "completed",
          timestamp: localISOTimestamp(),
          status: opts.status as CompletionStatus,
          summary: opts.summary,
          ...(opts.logFile ? { log_file: opts.logFile } : {}),
          ...(rating && { rating }),
        };

        appendRegistryEvent(event);
        console.log(
          `Completed: ${deployId} [${opts.status}] — ${opts.summary}`
        );
      }
    );

  // pa registry list
  cmd
    .command("list")
    .description("List recent deployments")
    .option("--team <name>", "Filter by team name")
    .option("--status <status>", "Filter by status (running|success|partial|failed|dead)")
    .option("--since <YYYY-MM-DD>", "Show deployments since date")
    .option("--limit <N>", "Maximum number of results (default 20)", parseInt)
    .action(
      (opts: { team?: string; status?: string; since?: string; limit?: number }) => {
        const limit = opts.limit ?? 20;
        const statuses = computeDeploymentStatuses(readRegistry());

        let filtered = statuses;
        if (opts.team) {
          filtered = filtered.filter((d) => d.team === opts.team);
        }
        if (opts.status) {
          filtered = filtered.filter((d) => d.status === opts.status);
        }
        if (opts.since) {
          filtered = filtered.filter((d) => d.started_at.startsWith(opts.since!));
        }
        filtered = filtered.slice(0, limit);

        if (filtered.length === 0) {
          console.log("No deployments found.");
          return;
        }

        // Table header
        console.log(
          `${"DEPLOY_ID".padEnd(12)} ${"TEAM".padEnd(12)} ${"STATUS".padEnd(10)} ${"STARTED_AT".padEnd(25)} SUMMARY`
        );
        console.log("-".repeat(90));
        for (const d of filtered) {
          const summary = (d.summary ?? "-").substring(0, 40);
          console.log(
            `${d.deploy_id.padEnd(12)} ${d.team.padEnd(12)} ${d.status.padEnd(10)} ${d.started_at.padEnd(25)} ${summary}`
          );
        }
        console.log(`\n(${filtered.length} deployment${filtered.length !== 1 ? "s" : ""})`);
      }
    );

  // pa registry show <deploy-id>
  cmd
    .command("show <deploy-id>")
    .description("Show all events and computed status for a deployment")
    .action((deployId: string) => {
      const events = getDeploymentEvents(deployId);
      if (events.length === 0) {
        console.error(`Error: Deployment "${deployId}" not found.`);
        process.exit(1);
      }

      const statuses = computeDeploymentStatuses(events);
      const status = statuses[0];

      // Header
      console.log(`=== Deployment: ${deployId} ===`);
      console.log(`Team:     ${status.team}`);
      console.log(`Status:   ${status.status}`);
      console.log(`Started:  ${status.started_at}`);
      if (status.completed_at) {
        console.log(`Ended:    ${status.completed_at}`);
      }
      if (status.agents.length > 0) {
        console.log(`Agents:   ${status.agents.join(", ")}`);
      }
      if (status.ticket_id) {
        console.log(`Ticket:   ${status.ticket_id}`);
      }
      if (status.objective) {
        console.log(`Objective: ${status.objective}`);
      }
      if (status.summary) {
        console.log(`Summary:  ${status.summary}`);
      }

      // Event timeline
      console.log("\n--- Event Timeline ---");
      for (const ev of events) {
        const extras: string[] = [];
        if (ev.pid) extras.push(`pid=${ev.pid}`);
        if (ev.status) extras.push(`status=${ev.status}`);
        if (ev.exit_code !== undefined) extras.push(`exit_code=${ev.exit_code}`);
        if (ev.summary) extras.push(`"${ev.summary}"`);
        if (ev.rating) extras.push(`rating=${ev.rating.overall}/${ev.rating.source}`);
        const extra = extras.length > 0 ? ` [${extras.join(", ")}]` : "";
        console.log(`  ${ev.timestamp}  ${ev.event.padEnd(10)}${extra}`);
      }
    });

  // pa registry clean
  cmd
    .command("clean")
    .description("Detect orphaned deployments (started but not completed/crashed)")
    .option("--threshold <hours>", "Hours after which a running deployment is considered orphaned (default 6)", parseFloat)
    .option("--dry-run", "List orphans without modifying the registry (default: true)", true)
    .option("--mark-dead", "Mark orphaned deployments as dead (crashed)")
    .action(
      (opts: { threshold?: number; dryRun?: boolean; markDead?: boolean }) => {
        const thresholdHours = opts.threshold ?? 6;
        const thresholdMs = thresholdHours * 60 * 60 * 1000;
        const now = Date.now();

        const statuses = computeDeploymentStatuses(readRegistry());
        const orphans = statuses.filter((d) => {
          if (d.status !== "running") return false;
          const startedTime = new Date(d.started_at).getTime();
          return now - startedTime > thresholdMs;
        });

        if (orphans.length === 0) {
          console.log("No orphaned deployments found.");
          return;
        }

        console.log(`Found ${orphans.length} orphaned deployment(s) (running > ${thresholdHours}h):`);
        console.log(`${"DEPLOY_ID".padEnd(12)} ${"TEAM".padEnd(12)} ${"STARTED_AT".padEnd(25)} DURATION`);
        console.log("-".repeat(65));
        for (const d of orphans) {
          const startedMs = new Date(d.started_at).getTime();
          const durationHours = ((now - startedMs) / (1000 * 60 * 60)).toFixed(1);
          console.log(
            `${d.deploy_id.padEnd(12)} ${d.team.padEnd(12)} ${d.started_at.padEnd(25)} ${durationHours}h`
          );
        }

        if (opts.dryRun || !opts.markDead) {
          console.log("\n(Dry-run: no changes made. Use --mark-dead to mark them as crashed.)");
        } else {
          console.log("\nMarking orphaned deployments as dead...");
          for (const d of orphans) {
            const event: RegistryEvent = {
              deployment_id: d.deploy_id,
              team: d.team,
              event: "crashed",
              timestamp: localISOTimestamp(),
              exit_code: -1,
              summary: "Marked as dead by registry clean",
            };
            appendRegistryEvent(event);
            console.log(`  Marked dead: ${d.deploy_id}`);
          }
        }
      }
    );

  // pa registry rotate
  cmd
    .command("rotate")
    .description("Archive old registry events to monthly archive files")
    .option("--retention <days>", "Delete archives older than N days (default 90)", parseInt)
    .option("--dry-run", "Show what would be archived/deleted without modifying")
    .action(
      (opts: { retention?: number; dryRun?: boolean }) => {
        const retentionDays = opts.retention ?? 90;
        const registryPath = getRegistryPath();
        const registryDir = resolve(registryPath, "..");

        // Get current month prefix for filtering
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1;

        // Read current registry
        const events = readRegistry();

        // Partition events: current month vs older
        const olderEvents: RegistryEvent[] = [];
        const currentMonthEvents: RegistryEvent[] = [];

        for (const ev of events) {
          const evDate = new Date(ev.timestamp);
          if (evDate.getFullYear() < currentYear ||
              (evDate.getFullYear() === currentYear && evDate.getMonth() + 1 < currentMonth)) {
            olderEvents.push(ev);
          } else {
            currentMonthEvents.push(ev);
          }
        }

        // Group older events by year-month
        const byMonth = new Map<string, RegistryEvent[]>();
        for (const ev of olderEvents) {
          const d = new Date(ev.timestamp);
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
          const group = byMonth.get(key) ?? [];
          group.push(ev);
          byMonth.set(key, group);
        }

        console.log(`Registry has ${events.length} total events.`);
        console.log(`Current month events: ${currentMonthEvents.length}.`);
        console.log(`Events to archive: ${olderEvents.length}.`);

        if (opts.dryRun) {
          if (olderEvents.length > 0) {
            console.log("\nWould archive the following months:");
            for (const [month, monthEvents] of byMonth) {
              console.log(`  ${month}: ${monthEvents.length} events → registry-${month}.jsonl.gz`);
            }
          } else {
            console.log("\nNo events to archive.");
          }

          // Check retention
          const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
          console.log(`\nRetention: ${retentionDays} days. Archives older than ${new Date(cutoffMs).toISOString().slice(0, 10)} would be deleted.`);

          // Find existing archives
          const archives = readdirSync(registryDir).filter((f) => f.startsWith("registry-") && f.endsWith(".jsonl.gz"));
          const oldArchives = archives.filter((f) => {
            const match = f.match(/registry-(\d{4}-\d{2})\.jsonl\.gz/);
            if (!match) return false;
            const archDate = new Date(match[1] + "-01");
            return archDate.getTime() < cutoffMs;
          });

          if (oldArchives.length > 0) {
            console.log("\nArchives that would be deleted:");
            for (const f of oldArchives) {
              console.log(`  ${f}`);
            }
          } else {
            console.log("\nNo archives to delete.");
          }
        } else {
          // Actually archive
          for (const [month, monthEvents] of byMonth) {
            const archivePath = resolve(registryDir, `registry-${month}.jsonl.gz`);
            const jsonlContent = monthEvents.map((e) => JSON.stringify(e)).join("\n") + "\n";

            // Compress to gzip
            const tempFile = archivePath + ".tmp";
            writeFileSync(tempFile, jsonlContent);
            // Use gzip command for compression
            execSync(`gzip -c "${tempFile}" > "${archivePath}"`);
            unlinkSync(tempFile);
            console.log(`Archived: ${archivePath} (${monthEvents.length} events)`);
          }

          // Rewrite current month events to registry.jsonl (remove older events)
          const currentJsonl = currentMonthEvents.map((e) => JSON.stringify(e)).join("\n") + "\n";
          writeFileSync(registryPath, currentJsonl);

          // Delete old archives per retention
          const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
          const archives = readdirSync(registryDir).filter((f) => f.startsWith("registry-") && f.endsWith(".jsonl.gz"));
          for (const f of archives) {
            const match = f.match(/registry-(\d{4}-\d{2})\.jsonl\.gz/);
            if (!match) continue;
            const archDate = new Date(match[1] + "-01");
            if (archDate.getTime() < cutoffMs) {
              unlinkSync(resolve(registryDir, f));
              console.log(`Deleted old archive: ${f}`);
            }
          }

          console.log("Rotation complete.");
        }
      }
    );

  return cmd;
}
