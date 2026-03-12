import { Command } from "commander";
import { teamsCommand } from "./commands/teams.js";

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
  .action(() => {
    console.error("Not yet implemented — use pa-deploy (bash) for now.");
    process.exit(1);
  });

program
  .command("daily")
  .description("Daily lifecycle (plan|progress|end)")
  .action(() => {
    console.error("Not yet implemented — use pa-daily (bash) for now.");
    process.exit(1);
  });

program
  .command("status")
  .description("Show deployment status")
  .action(() => {
    console.error("Not yet implemented — use pa-status (bash) for now.");
    process.exit(1);
  });

program
  .command("schedule")
  .description("Schedule a team with systemd timers")
  .action(() => {
    console.error("Not yet implemented — use pa-schedule (bash) for now.");
    process.exit(1);
  });

program
  .command("timers")
  .description("List scheduled timers")
  .action(() => {
    console.error("Not yet implemented — use pa-timers (bash) for now.");
    process.exit(1);
  });

program
  .command("remove-timer")
  .description("Remove a scheduled timer")
  .action(() => {
    console.error(
      "Not yet implemented — use pa-remove-timer (bash) for now."
    );
    process.exit(1);
  });

program
  .command("idea")
  .description("Log an idea interactively")
  .action(() => {
    console.error("Not yet implemented — use pa-idea (bash) for now.");
    process.exit(1);
  });

program.parse();
