import { Command } from "commander";
import {
  appendRegistryEvent,
  getDeploymentEvents,
  readRegistry,
  queryDeploymentStatuses,
  queryDeploymentStatus,
  checkJsonlDeprecation,
} from "../lib/registry.js";
import { localISOTimestamp } from "../lib/time.js";
import type { Rating, RegistryEvent } from "../lib/types.js";
import { getRegistryPath, getRegistryDbPath } from "../lib/paths.js";
import { getDb } from "../lib/registry-db.js";
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync, renameSync } from "node:fs";
import { resolve } from "node:path";

const VALID_STATUSES = ["success", "partial", "failed"] as const;
type CompletionStatus = (typeof VALID_STATUSES)[number];

const VALID_RATING_SOURCES = ["agent", "system", "user"] as const;
type RatingSource = (typeof VALID_RATING_SOURCES)[number];

export function createRegistryCommand(): Command {
  const cmd = new Command("registry").description("Manage deployment registry (data, search, analytics, migration)");

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
        const statuses = queryDeploymentStatuses();

        let filtered = statuses;
        if (opts.team) {
          filtered = filtered.filter((d) => d.team === opts.team);
        }
        if (opts.status) {
          const validStatuses = ["running", "success", "partial", "failed", "crashed", "dead"];
          if (!validStatuses.includes(opts.status)) {
            console.error(
              `Error: Invalid status '${opts.status}'. Must be one of: ${validStatuses.join(", ")}`
            );
            process.exit(1);
          }
          filtered = filtered.filter((d) => d.status === opts.status);
        }
        if (opts.since) {
          filtered = filtered.filter((d) => d.started_at >= opts.since!);
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

      const status = queryDeploymentStatus(deployId);
      if (!status) {
        console.error(`Error: Deployment "${deployId}" not found in deployments table.`);
        process.exit(1);
      }

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

        const statuses = queryDeploymentStatuses();
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
        // Deprecation warning
        console.error(
          "Warning: 'pa registry rotate' is deprecated. SQLite storage does not require JSONL rotation. " +
            "Use 'pa registry clean' to manage orphaned deployments and 'pa registry archive-jsonl' to archive the legacy JSONL file."
        );

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

  // pa registry migrate
  cmd
    .command("migrate")
    .description("Migrate existing JSONL registry to SQLite")
    .option("--force", "Force re-migration even if data exists")
    .action((opts: { force?: boolean }) => {
      const registryPath = getRegistryPath();
      const dbPath = getRegistryDbPath();

      // Check if JSONL file exists
      if (!existsSync(registryPath)) {
        console.log("No JSONL registry found. Nothing to migrate.");
        return;
      }

      // Open SQLite DB
      const db = getDb();

      // Idempotent check
      const existingCount = db
        .prepare("SELECT COUNT(*) as count FROM registry_events")
        .get() as { count: number };

      if (existingCount.count > 0 && !opts.force) {
        console.log(
          `Registry already has ${existingCount.count} events. Use --force to re-migrate.`
        );
        return;
      }

      // If force, clear existing data
      if (opts.force && existingCount.count > 0) {
        console.log(`Clearing existing ${existingCount.count} events...`);
        db.exec("DELETE FROM registry_events");
        db.exec("DELETE FROM deployments");
      }

      // Read JSONL directly (readRegistry() now queries SQLite, so read JSONL directly here)
      const fileContent = readFileSync(registryPath, "utf-8");
      const lines = fileContent.split("\n").filter((l) => l.trim());
      const jsonlCount = lines.length;

      if (jsonlCount === 0) {
        console.log("JSONL registry is empty. Nothing to migrate.");
        return;
      }

      console.log(`Migrating ${jsonlCount} events from JSONL to SQLite...`);

      // Begin transaction
      const migrateStmt = db.prepare(`
        INSERT INTO registry_events (
          deployment_id, team, event, timestamp, pid, status, summary,
          log_file, primer, agents, models, error, exit_code,
          ticket_id, provider, rating, objective, repo
        ) VALUES (
          @deployment_id, @team, @event, @timestamp, @pid, @status, @summary,
          @log_file, @primer, @agents, @models, @error, @exit_code,
          @ticket_id, @provider, @rating, @objective, @repo
        )
      `);

      const insertDeploymentStmt = db.prepare(`
        INSERT INTO deployments (
          deployment_id, team, status, started_at, pid, primer,
          agents, models, ticket_id, objective, repo, provider
        ) VALUES (
          @deployment_id, @team, 'running', @started_at, @pid, @primer,
          @agents, @models, @ticket_id, @objective, @repo, @provider
        )
      `);

      const updateDeploymentStmt = db.prepare(`
        UPDATE deployments SET
          status = @status,
          completed_at = @completed_at,
          summary = @summary,
          log_file = @log_file,
          rating = @rating,
          exit_code = @exit_code
        WHERE deployment_id = @deployment_id
      `);

      const crashDeploymentStmt = db.prepare(`
        UPDATE deployments SET
          status = 'crashed',
          completed_at = @completed_at,
          error = @error,
          exit_code = @exit_code
        WHERE deployment_id = @deployment_id
      `);

      db.exec("BEGIN TRANSACTION");

      const BATCH_SIZE = 1000;
      let insertedCount = 0;
      const seenDeployments = new Set<string>();

      for (let i = 0; i < lines.length; i++) {
        try {
          const event = JSON.parse(lines[i]) as RegistryEvent;

          // INSERT INTO registry_events
          migrateStmt.run({
            deployment_id: event.deployment_id,
            team: event.team,
            event: event.event,
            timestamp: event.timestamp,
            pid: event.pid ?? null,
            status: event.status ?? null,
            summary: event.summary ?? null,
            log_file: event.log_file ?? null,
            primer: event.primer ?? null,
            agents: event.agents ? JSON.stringify(event.agents) : null,
            models: event.models ? JSON.stringify(event.models) : null,
            error: event.error ?? null,
            exit_code: event.exit_code ?? null,
            ticket_id: event.ticket_id ?? null,
            provider: event.provider ?? null,
            rating: event.rating ? JSON.stringify(event.rating) : null,
            objective: event.objective ?? null,
            repo: event.repo ?? null,
          });
          insertedCount++;

          // UPSERT into deployments
          if (!seenDeployments.has(event.deployment_id)) {
            seenDeployments.add(event.deployment_id);

            if (event.event === "started") {
              insertDeploymentStmt.run({
                deployment_id: event.deployment_id,
                team: event.team,
                started_at: event.timestamp,
                pid: event.pid ?? null,
                primer: event.primer ?? null,
                agents: event.agents ? JSON.stringify(event.agents) : null,
                models: event.models ? JSON.stringify(event.models) : null,
                ticket_id: event.ticket_id ?? null,
                objective: event.objective ?? null,
                repo: event.repo ?? null,
                provider: event.provider ?? null,
              });
            }
          }

          if (event.event === "completed") {
            updateDeploymentStmt.run({
              deployment_id: event.deployment_id,
              status: event.status ?? "success",
              completed_at: event.timestamp,
              summary: event.summary ?? null,
              log_file: event.log_file ?? null,
              rating: event.rating ? JSON.stringify(event.rating) : null,
              exit_code: event.exit_code ?? null,
            });
          } else if (event.event === "crashed") {
            crashDeploymentStmt.run({
              deployment_id: event.deployment_id,
              completed_at: event.timestamp,
              error: event.error ?? null,
              exit_code: event.exit_code ?? null,
            });
          }

          // Commit in batches
          if ((i + 1) % BATCH_SIZE === 0) {
            db.exec("COMMIT");
            db.exec("BEGIN TRANSACTION");
            process.stdout.write(`\r  Inserted ${i + 1}/${jsonlCount} events...`);
          }
        } catch (err) {
          console.error(`\nError parsing line ${i + 1}: ${err}`);
        }
      }

      db.exec("COMMIT");
      console.log(`\r  Inserted ${insertedCount}/${jsonlCount} events.`);

      // Verify counts
      const finalEventCount = db
        .prepare("SELECT COUNT(*) as count FROM registry_events")
        .get() as { count: number };
      const finalDeployCount = db
        .prepare("SELECT COUNT(*) as count FROM deployments")
        .get() as { count: number };

      // Get DB size
      const dbStats = statSync(dbPath);
      const dbSizeKB = (dbStats.size / 1024).toFixed(1);

      console.log(
        `Migration complete: ${finalEventCount.count} events, ${finalDeployCount.count} deployments. DB size: ${dbSizeKB} KB`
      );
    });

  // pa registry search <query>
  cmd
    .command("search <query>")
    .description("Search deployments using FTS5 full-text search")
    .option("--limit <N>", "Maximum results (default 20)", parseInt)
    .action((query: string, opts: { limit?: number }) => {
      // Check JSONL deprecation on each command run
      checkJsonlDeprecation();

      // Validate non-empty query
      if (!query || query.trim() === "") {
        console.error("Error: Search query cannot be empty.");
        process.exit(1);
      }

      const limit = opts.limit ?? 20;
      const db = getDb();

      // FTS5 MATCH with snippet highlighting
      // snippet() returns: [start], matched text, [end], ... context, max_tokens
      let rows: Array<{
        deployment_id: string;
        team: string;
        status: string;
        started_at: string;
        snippet: string;
      }>;
      try {
        rows = db
          .prepare(`
            SELECT d.deployment_id, d.team, d.status, d.started_at,
                   snippet(deployments_fts, 1, '[', ']', '...', 20) as snippet
            FROM deployments_fts f
            JOIN deployments d ON d.rowid = f.rowid
            WHERE deployments_fts MATCH ?
            ORDER BY rank
            LIMIT ?
          `)
          .all(query, limit) as Array<{
            deployment_id: string;
            team: string;
            status: string;
            started_at: string;
            snippet: string;
          }>;
      } catch (err) {
        if (err instanceof Error && err.message.includes("fts5")) {
          console.error("Error: Invalid search query. Use simple keywords (e.g., \"sqlite migration\").");
          process.exit(1);
        }
        throw err;
      }

      if (rows.length === 0) {
        console.log("No results found.");
        return;
      }

      console.log(
        `${"DEPLOY_ID".padEnd(12)} ${"TEAM".padEnd(12)} ${"STATUS".padEnd(10)} ${"STARTED_AT".padEnd(25)} SNIPPET`
      );
      console.log("-".repeat(100));
      for (const r of rows) {
        const snippet = r.snippet ?? "-";
        console.log(
          `${r.deployment_id.padEnd(12)} ${r.team.padEnd(12)} ${r.status.padEnd(10)} ${r.started_at.padEnd(25)} ${snippet}`
        );
      }
      console.log(`\n(${rows.length} result${rows.length !== 1 ? "s" : ""})`);
    });

  // pa registry analytics
  cmd
    .command("analytics")
    .description("Show analytics views: deployments per day, team activity, rating trends")
    .option("--view <name>", "Filter by view (daily|teams|ratings or SQL view names)")
    .option("--team <name>", "Filter by team (for v_team_activity)")
    .option("--since <YYYY-MM-DD>", "Filter deployments since date")
    .action((opts: { view?: string; team?: string; since?: string }) => {
      checkJsonlDeprecation();

      const db = getDb();

      // Map user-friendly names to SQL view names
      const viewMap: Record<string, string> = {
        daily: "v_deployments_per_day",
        teams: "v_team_activity",
        ratings: "v_rating_trends",
      };
      const resolvedView = opts.view ? (viewMap[opts.view] ?? opts.view) : undefined;

      // Deployments per day
      if (!resolvedView || resolvedView === "v_deployments_per_day") {
        const deployDaySql = opts.since
          ? "SELECT day, count, successes, failures FROM v_deployments_per_day WHERE day >= ? ORDER BY day DESC LIMIT 30"
          : "SELECT day, count, successes, failures FROM v_deployments_per_day ORDER BY day DESC LIMIT 30";
        const rows = (opts.since
          ? db.prepare(deployDaySql).all(opts.since)
          : db.prepare(deployDaySql).all()) as Array<{
            day: string;
            count: number;
            successes: number;
            failures: number;
          }>;

        console.log("=== Deployments Per Day ===");
        console.log(
          `${"DAY".padEnd(12)} ${"COUNT".padEnd(8)} ${"SUCCESSES".padEnd(10)} ${"FAILURES"}`
        );
        console.log("-".repeat(50));
        for (const r of rows) {
          console.log(
            `${r.day.padEnd(12)} ${String(r.count).padEnd(8)} ${String(r.successes).padEnd(10)} ${r.failures}`
          );
        }
        console.log();
      }

      // Team activity
      if (!resolvedView || resolvedView === "v_team_activity") {
        const teamSql = opts.team
          ? "SELECT team, total, last_deployment FROM v_team_activity WHERE team = ? ORDER BY total DESC"
          : "SELECT team, total, last_deployment FROM v_team_activity ORDER BY total DESC";
        const rows = (opts.team
          ? db.prepare(teamSql).all(opts.team)
          : db.prepare(teamSql).all()) as Array<{
            team: string;
            total: number;
            last_deployment: string;
          }>;

        console.log("=== Team Activity ===");
        console.log(
          `${"TEAM".padEnd(20)} ${"TOTAL".padEnd(8)} ${"LAST_DEPLOYMENT"}`
        );
        console.log("-".repeat(60));
        for (const r of rows) {
          console.log(
            `${r.team.padEnd(20)} ${String(r.total).padEnd(8)} ${r.last_deployment}`
          );
        }
        console.log();
      }

      // Rating trends
      if (!resolvedView || resolvedView === "v_rating_trends") {
        const ratingSql = opts.since
          ? "SELECT day, team, avg_overall, avg_productivity, avg_quality FROM v_rating_trends WHERE day >= ? ORDER BY day DESC, team LIMIT 60"
          : "SELECT day, team, avg_overall, avg_productivity, avg_quality FROM v_rating_trends ORDER BY day DESC, team LIMIT 60";
        const rows = (opts.since
          ? db.prepare(ratingSql).all(opts.since)
          : db.prepare(ratingSql).all()) as Array<{
            day: string;
            team: string;
            avg_overall: number | null;
            avg_productivity: number | null;
            avg_quality: number | null;
          }>;

        console.log("=== Rating Trends ===");
        console.log(
          `${"DAY".padEnd(12)} ${"TEAM".padEnd(16)} ${"AVG_O".padEnd(8)} ${"AVG_P".padEnd(8)} ${"AVG_Q"}`
        );
        console.log("-".repeat(60));
        for (const r of rows) {
          const avgO = r.avg_overall !== null ? (r.avg_overall as number).toFixed(2) : "N/A";
          const avgP = r.avg_productivity !== null ? (r.avg_productivity as number).toFixed(2) : "N/A";
          const avgQ = r.avg_quality !== null ? (r.avg_quality as number).toFixed(2) : "N/A";
          console.log(
            `${r.day.padEnd(12)} ${r.team.padEnd(16)} ${avgO.padEnd(8)} ${avgP.padEnd(8)} ${avgQ}`
          );
        }
      }
    });

  // pa registry archive-jsonl
  cmd
    .command("archive-jsonl")
    .description("Archive the legacy JSONL registry file to registry.jsonl.bak")
    .action(() => {
      const registryPath = getRegistryPath();
      const bakPath = registryPath + ".bak";

      if (!existsSync(registryPath)) {
        console.log("No JSONL registry file found. Nothing to archive.");
        return;
      }

      renameSync(registryPath, bakPath);
      console.log(`Archived registry.jsonl to ${bakPath}`);
    });

  return cmd;
}
