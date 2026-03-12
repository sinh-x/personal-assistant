import { Command } from "commander";
import { teamsCommand } from "./commands/teams.js";
import { deployCommand } from "./commands/deploy.js";
import { dailyCommand } from "./commands/daily.js";
import { statusCommand } from "./commands/status.js";
import { scheduleCommand } from "./commands/schedule.js";
import { timersCommand } from "./commands/timers.js";
import { removeTimerCommand } from "./commands/remove-timer.js";
import { ideaCommand } from "./commands/idea.js";

const program = new Command();

program
  .name("pa")
  .description("CLI agent team orchestrator for NixOS")
  .version("0.1.0");

program
  .command("teams")
  .description("List available teams")
  .action(() => {
    teamsCommand();
  });

program
  .command("deploy")
  .description("Deploy an agent team")
  .argument("<team>", "Team name or path to YAML file")
  .option("--dry-run", "Generate primer and print it, no execution")
  .option("--foreground", "Run in foreground with auto-permissions")
  .option("--interactive", "Run in foreground, user approves each tool call")
  .option("--objective <text>", "Append extra instructions to the team objective")
  .action((team: string, opts: { dryRun?: boolean; foreground?: boolean; interactive?: boolean; objective?: string }) => {
    deployCommand(team, opts);
  });

program
  .command("daily")
  .description("Daily lifecycle (plan|progress|end)")
  .argument("<mode>", "Mode: plan | progress | end")
  .argument("[date]", "Target date (YYYY-MM-DD)")
  .option("--dry-run", "Generate primer and print it, no execution")
  .option("--foreground", "Run in foreground with auto-permissions")
  .option("--interactive", "Run in foreground, user approves each tool call")
  .action((mode: string, date: string | undefined, opts: { dryRun?: boolean; foreground?: boolean; interactive?: boolean }) => {
    const args: string[] = [];
    if (date) args.push(date);
    if (opts.dryRun) args.push("--dry-run");
    else if (opts.foreground) args.push("--foreground");
    else if (opts.interactive) args.push("--interactive");
    dailyCommand(mode, args);
  });

program
  .command("status")
  .description("Show deployment status")
  .argument("[deploy-id]", "Show details for a specific deployment")
  .option("--running", "Show only running deployments")
  .option("--team <name>", "Filter by team name")
  .action((deployId: string | undefined, opts: { running?: boolean; team?: string }) => {
    const args: string[] = [];
    if (opts.running) {
      args.push("--running");
    } else if (opts.team) {
      args.push("--team", opts.team);
    } else if (deployId) {
      args.push(deployId);
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
  .command("idea")
  .description("Log an idea interactively")
  .action(async () => {
    await ideaCommand();
  });

program.parse();
