import { Command } from "commander";
import { teamsCommand, boardCommand } from "./commands/teams.js";
import { deployCommand } from "./commands/deploy.js";
import { statusCommand } from "./commands/status.js";
import { scheduleCommand } from "./commands/schedule.js";
import { timersCommand } from "./commands/timers.js";
import { removeTimerCommand } from "./commands/remove-timer.js";
import { ideaCommand } from "./commands/idea.js";
import { reportCommand } from "./commands/report.js";
import { requirementsCommand } from "./commands/requirements.js";
import { reposCommand } from "./commands/repos.js";
import { resolveProject, resolveProjectFromCwd, listRepos } from "./lib/repos.js";
import { serveCommand, serveStopCommand, serveRestartCommand, serveStatusCommand, DEFAULT_PORT, DEFAULT_HOST } from "./commands/serve.js";
import { createTicketCommand } from "./commands/ticket.js";
import { createBulletinCommand } from "./commands/bulletin.js";
import { createRegistryCommand } from "./commands/registry.js";
import { createTrashCommand } from "./commands/trash.js";
import { createCodeCtxCommand } from "./commands/codectx.js";
import { createSignalCommand } from "./commands/signal.js";

declare const __PA_VERSION__: string;

const program = new Command();

program
  .name("pa")
  .description("CLI agent team orchestrator for NixOS")
  .version(__PA_VERSION__);

program
  .command("teams")
  .description("Show agent team workflow status. Active tickets only by default. With [name]: show board for one team.")
  .argument("[name]", "Team name for detailed view")
  .option("--all", "Show all tickets including backlog, archived, and terminal")
  .action((name: string | undefined, opts: { all?: boolean }) => {
    teamsCommand(name, opts);
  });

program
  .command("board")
  .description(
    "Show kanban board — all tickets grouped by status with assignee. Defaults to current repo's project. Use --all for all projects."
  )
  .option("--project <name>", "Filter by project (key, prefix, or basename)")
  .option("--all", "Show all projects")
  .option("--assignee <name>", "Filter by assignee")
  .action(
    (opts: { project?: string; all?: boolean; assignee?: string }) => {
      let project: string | undefined;
      if (opts.all) {
        project = undefined; // all projects
      } else if (opts.project) {
        try {
          const resolved = resolveProject(opts.project);
          project = resolved.key;
        } catch (err: unknown) {
          console.error((err as Error).message);
          process.exit(1);
        }
      } else {
        const cwd = resolveProjectFromCwd();
        if (!cwd) {
          console.error("Not in a registered repo. Use --all or --project <name>");
          const available = listRepos()
            .filter((r) => r.prefix)
            .map((r) => r.name)
            .join(", ");
          if (available) {
            console.error(`Available projects: ${available}`);
          }
          process.exit(1);
        }
        project = cwd.key;
      }
      boardCommand(project, {
        assignee: opts.assignee,
        excludeTags: ["backlog", "archived"],
        excludeTypes: ["fyi", "work-report"],
      });
    }
  );

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
  .option("--ticket <id>", "Link deployment to a ticket")
  .option("--validate", "Validate team config, skill files, mode files, and template variables without deploying")
  .option("--provider <name>", "API provider: anthropic (default) or minimax")
  .option("--timeout <seconds>", "Override deployment timeout in seconds (default: 2700, min: 60, max: 7200)")
  .option("--resume <deploy-id>", "Resume a deployment by deploy-id")
  .action((team: string, opts: { dryRun?: boolean; background?: boolean; interactive?: boolean; objective?: string; direct?: boolean; teamModel?: string; agentModel?: string; mode?: string; listModes?: boolean; repo?: string; ticket?: string; validate?: boolean; provider?: string; timeout?: number; resume?: string }) => {
    deployCommand(team, opts);
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
  .option("--recent <n>", "Show only the N most recent deployments")
  .option("--today", "Show only today's deployments")
  .action((deployId: string | undefined, opts: { running?: boolean; team?: string; wait?: boolean; report?: boolean; artifacts?: boolean; activity?: boolean; recent?: string; today?: boolean }) => {
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
    if (opts.recent) args.push("--recent", opts.recent);
    if (opts.today) args.push("--today");
    statusCommand(args);
  });

program
  .command("schedule")
  .description("Schedule a team with systemd timers")
  .argument("<spec>", "Team name, daily:<mode>, or requirements:<mode>")
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
  .description("Requirements lifecycle (ideas | focus)")
  .argument("<mode>", "Mode: ideas, focus")
  .option("--force", "Re-triage all ideas, not just new ones")
  .option("--dry-run", "Generate primer and print it, no execution")
  .option("--background", "Run in background (default for ideas)")
  .option("--interactive", "Run in foreground, user approves each tool call")
  .option("--project <name>", "Filter focus list by project")
  .option("--assignee <name>", "Filter focus list by assignee")
  .option("--all", "Include idea and requirement-review stages in focus list")
  .option("--mine", "Short for --assignee sinh")
  .option("--enrich", "Include AI suggestions from latest cached focus report")
  .action((mode: string, opts: { force?: boolean; dryRun?: boolean; background?: boolean; interactive?: boolean; project?: string; assignee?: string; all?: boolean; mine?: boolean; enrich?: boolean }) => {
    const args: string[] = [];
    if (opts.force) args.push("--force");
    if (opts.dryRun) args.push("--dry-run");
    else if (opts.background) args.push("--background");
    else if (opts.interactive) args.push("--interactive");
    if (opts.project) { args.push("--project", opts.project); }
    if (opts.assignee) { args.push("--assignee", opts.assignee); }
    if (opts.all) args.push("--all");
    if (opts.mine) args.push("--mine");
    if (opts.enrich) args.push("--enrich");
    requirementsCommand(mode, args);
  });

program
  .command("idea")
  .description("Log an idea interactively")
  .action(async () => {
    await ideaCommand();
  });

program.addCommand(createSignalCommand());

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

const serveCmd = program
  .command("serve")
  .description("Start the agent API server (Hono)")
  .option("--port <number>", "Port to listen on", String(DEFAULT_PORT))
  .option("--host <address>", "Host address to bind to", DEFAULT_HOST)
  .option("--background", "Run in background mode (writes PID file)")
  .option("--cors", "Enable CORS headers")
  .option("--force", "Kill existing instance and restart")
  .action(async (opts: { port: string; host: string; background?: boolean; cors?: boolean; force?: boolean }) => {
    await serveCommand({
      port: parseInt(opts.port, 10),
      host: opts.host,
      background: opts.background ?? false,
      cors: opts.cors ?? false,
      force: opts.force ?? false,
    });
  });

serveCmd
  .command("stop")
  .description("Stop a running pa serve instance")
  .action(async () => {
    await serveStopCommand();
  });

serveCmd
  .command("restart")
  .description("Stop existing instance and start a new one")
  .option("--port <number>", "Port to listen on", String(DEFAULT_PORT))
  .option("--host <address>", "Host address to bind to", DEFAULT_HOST)
  .option("--background", "Run in background mode (writes PID file)")
  .option("--cors", "Enable CORS headers")
  .action(async (opts: { port: string; host: string; background?: boolean; cors?: boolean }) => {
    await serveRestartCommand({
      port: parseInt(opts.port, 10),
      host: opts.host,
      background: opts.background ?? false,
      cors: opts.cors ?? false,
    });
  });

serveCmd
  .command("status")
  .description("Show pa serve running state, PID, and port")
  .action(() => {
    serveStatusCommand();
  });

program.addCommand(createTicketCommand());
program.addCommand(createBulletinCommand());
program.addCommand(createRegistryCommand());
program.addCommand(createTrashCommand());
program.addCommand(createCodeCtxCommand());

program.parse();
