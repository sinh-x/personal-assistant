import { Command } from "commander";
import { teamsCommand } from "./commands/teams.js";
import { deployCommand } from "./commands/deploy.js";
import { dailyCommand } from "./commands/daily.js";
import { statusCommand } from "./commands/status.js";
import { scheduleCommand } from "./commands/schedule.js";
import { timersCommand } from "./commands/timers.js";
import { removeTimerCommand } from "./commands/remove-timer.js";
import { ideaCommand } from "./commands/idea.js";
import { reportCommand } from "./commands/report.js";
import { requirementsCommand } from "./commands/requirements.js";
import { reposCommand } from "./commands/repos.js";
import { serveCommand, DEFAULT_PORT, DEFAULT_HOST } from "./commands/serve.js";
import { createTicketCommand } from "./commands/ticket.js";
import { createBulletinCommand } from "./commands/bulletin.js";

declare const __PA_VERSION__: string;

const program = new Command();

program
  .name("pa")
  .description("CLI agent team orchestrator for NixOS")
  .version(__PA_VERSION__);

program
  .command("teams")
  .description("Show agent team workflow status (inbox/ongoing/wfr counts). With [name]: show folder detail for one team.")
  .argument("[name]", "Team name for detailed view")
  .action((name?: string) => {
    teamsCommand(name);
  });

program
  .command("deploy")
  .description("Deploy an agent team")
  .argument("<team>", "Team name or path to YAML file")
  .option("--dry-run", "Generate primer and print it, no execution")
  .option("--background", "Run in background (default for timers/automated)")
  .option("--interactive", "Run in foreground, user approves each tool call")
  .option("--objective <text>", "Append extra instructions to the team objective")
  .option("--direct", "Lightweight direct mode — no sub-agents, skip-permissions")
  .option("--team-model <model>", "Model for the team-manager process (haiku|sonnet|opus)")
  .option("--agent-model <model>", "Model for all named agents, overrides per-agent YAML (haiku|sonnet|opus)")
  .option("--mode <mode-id>", "Deploy using a specific mode (reads mode file as objective)")
  .option("--list-modes", "List available modes for the team and exit")
  .option("--repo <name>", "Target repo name from repos.yaml (overrides CWD-based detection)")
  .action((team: string, opts: { dryRun?: boolean; background?: boolean; interactive?: boolean; objective?: string; direct?: boolean; teamModel?: string; agentModel?: string; mode?: string; listModes?: boolean; repo?: string }) => {
    deployCommand(team, opts);
  });

program
  .command("daily")
  .description("Daily lifecycle (plan|progress|end)")
  .argument("<mode>", "Mode: plan | progress | end")
  .argument("[date]", "Target date (YYYY-MM-DD)")
  .option("--dry-run", "Generate primer and print it, no execution")
  .option("--background", "Run in background (default for timers/automated)")
  .option("--interactive", "Run in foreground, user approves each tool call")
  .option("--review", "Interactive review mode: end=review+synthesize, plan=finalize draft")
  .action((mode: string, date: string | undefined, opts: { dryRun?: boolean; background?: boolean; interactive?: boolean; review?: boolean }) => {
    const args: string[] = [];
    if (date) args.push(date);
    if (opts.review) args.push("--review");
    if (opts.dryRun) args.push("--dry-run");
    else if (opts.background) args.push("--background");
    else if (opts.interactive) args.push("--interactive");
    dailyCommand(mode, args);
  });

program
  .command("status")
  .description("Show deployment status")
  .argument("[deploy-id]", "Show details for a specific deployment")
  .option("--running", "Show only running deployments")
  .option("--team <name>", "Filter by team name")
  .option("--wait", "Block until deployment reaches a terminal state")
  .option("--report", "Show the work report for a deployment")
  .option("--artifacts", "List artifact files for a deployment")
  .option("--activity", "Show agent activity timeline for a deployment")
  .action((deployId: string | undefined, opts: { running?: boolean; team?: string; wait?: boolean; report?: boolean; artifacts?: boolean; activity?: boolean }) => {
    const args: string[] = [];
    if (opts.running) {
      args.push("--running");
    } else if (opts.team) {
      args.push("--team", opts.team);
    } else if (deployId) {
      args.push(deployId);
      if (opts.wait) args.push("--wait");
      else if (opts.report) args.push("--report");
      else if (opts.artifacts) args.push("--artifacts");
      else if (opts.activity) args.push("--activity");
    }
    statusCommand(args);
  });

program
  .command("schedule")
  .description("Schedule a team with systemd timers")
  .argument("<spec>", "Team name or daily:<mode>")
  .argument("<repeat>", "Repeat interval: hourly | daily | weekly | monthly")
  .argument("[times...]", "One or more HH:MM times")
  .action((spec: string, repeat: string, times: string[]) => {
    scheduleCommand(spec, repeat, times);
  });

program
  .command("timers")
  .description("List scheduled timers")
  .action(() => {
    timersCommand();
  });

program
  .command("remove-timer")
  .description("Remove a scheduled timer")
  .argument("<team-name>", "Name of the team timer to remove")
  .action((teamName: string) => {
    removeTimerCommand(teamName);
  });

program
  .command("requirements")
  .description("Requirements lifecycle (ideas)")
  .argument("<mode>", "Mode: ideas")
  .option("--force", "Re-triage all ideas, not just new ones")
  .option("--dry-run", "Generate primer and print it, no execution")
  .option("--background", "Run in background (default for ideas)")
  .option("--interactive", "Run in foreground, user approves each tool call")
  .action((mode: string, opts: { force?: boolean; dryRun?: boolean; background?: boolean; interactive?: boolean }) => {
    const args: string[] = [];
    if (opts.force) args.push("--force");
    if (opts.dryRun) args.push("--dry-run");
    else if (opts.background) args.push("--background");
    else if (opts.interactive) args.push("--interactive");
    requirementsCommand(mode, args);
  });

program
  .command("idea")
  .description("Log an idea interactively")
  .action(async () => {
    await ideaCommand();
  });

program
  .command("report")
  .description("Submit a bug report, feature request, agent self-report, or feedback")
  .action(async () => {
    await reportCommand();
  });

program
  .command("repos")
  .description("Manage repository roots registry")
  .argument("<subcommand>", "Subcommand: list")
  .action((sub: string) => {
    reposCommand(sub);
  });

program
  .command("serve")
  .description("Start the agent API server (Hono)")
  .option("--port <number>", "Port to listen on", String(DEFAULT_PORT))
  .option("--host <address>", "Host address to bind to", DEFAULT_HOST)
  .option("--background", "Run in background mode (writes PID file)")
  .option("--cors", "Enable CORS headers")
  .action(async (opts: { port: string; host: string; background?: boolean; cors?: boolean }) => {
    await serveCommand({
      port: parseInt(opts.port, 10),
      host: opts.host,
      background: opts.background ?? false,
      cors: opts.cors ?? false,
    });
  });

program.addCommand(createTicketCommand());
program.addCommand(createBulletinCommand());

program.parse();
