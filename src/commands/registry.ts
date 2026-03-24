import { Command } from "commander";
import { appendRegistryEvent, getDeploymentEvents } from "../lib/registry.js";
import { localISOTimestamp } from "../lib/time.js";
import type { RegistryEvent } from "../lib/types.js";

const VALID_STATUSES = ["success", "partial", "failed"] as const;
type CompletionStatus = (typeof VALID_STATUSES)[number];

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
    .action(
      (
        deployId: string,
        opts: { status: string; summary: string; logFile?: string }
      ) => {
        // Validate status
        if (!VALID_STATUSES.includes(opts.status as CompletionStatus)) {
          console.error(
            `Error: Invalid status "${opts.status}". Must be one of: success, partial, failed`
          );
          process.exit(1);
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

        const event: RegistryEvent = {
          deployment_id: deployId,
          team: started.team,
          event: "completed",
          timestamp: localISOTimestamp(),
          status: opts.status as CompletionStatus,
          summary: opts.summary,
          ...(opts.logFile ? { log_file: opts.logFile } : {}),
        };

        appendRegistryEvent(event);
        console.log(
          `Completed: ${deployId} [${opts.status}] — ${opts.summary}`
        );
      }
    );

  return cmd;
}
