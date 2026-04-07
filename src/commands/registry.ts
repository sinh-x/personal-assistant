import { Command } from "commander";
import { appendRegistryEvent, getDeploymentEvents } from "../lib/registry.js";
import { localISOTimestamp } from "../lib/time.js";
import type { Rating, RegistryEvent } from "../lib/types.js";

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

  return cmd;
}
