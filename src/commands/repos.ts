import { listRepos } from "../lib/repos.js";

export function reposCommand(sub: string): void {
  if (sub === "list") {
    const repos = listRepos();
    if (repos.length === 0) {
      console.log("No repos configured.");
      console.log("Create ~/.config/sinh-x/personal-assistant/repos.yaml to add repos.");
      return;
    }
    const nameW = Math.max(4, ...repos.map((r) => r.name.length));
    const pathW = Math.max(4, ...repos.map((r) => r.path.length));
    const pad = (s: string, w: number) => s.padEnd(w);
    console.log(`  ${pad("NAME", nameW)}  ${pad("PATH", pathW)}  DESCRIPTION`);
    console.log(`  ${"-".repeat(nameW)}  ${"-".repeat(pathW)}  -----------`);
    for (const repo of repos) {
      console.log(`  ${pad(repo.name, nameW)}  ${pad(repo.path, pathW)}  ${repo.description ?? ""}`);
    }
  } else {
    console.error(`Unknown repos subcommand: ${sub}`);
    console.error("Available subcommands: list");
    process.exit(1);
  }
}
