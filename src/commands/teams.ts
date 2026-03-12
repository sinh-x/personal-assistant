import { readdirSync, existsSync, readFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import { loadConfig } from "../lib/config.js";

/**
 * List available teams from config dir (user overrides) and PA_HOME (builtin).
 * Matches the output format of the bash `pa teams` command exactly.
 */
export function teamsCommand(): void {
  const config = loadConfig();

  const configTeamsDir = config.configDir
    ? resolve(config.configDir, "teams")
    : undefined;
  const builtinTeamsDir = resolve(config.homeDir, "teams");

  const seen = new Set<string>();

  // List from config dir first (user overrides), then builtin
  const dirs: Array<{ path: string; isUser: boolean }> = [];
  if (configTeamsDir && existsSync(configTeamsDir)) {
    dirs.push({ path: configTeamsDir, isUser: true });
  }
  if (existsSync(builtinTeamsDir)) {
    dirs.push({ path: builtinTeamsDir, isUser: false });
  }

  for (const dir of dirs) {
    const files = readdirSync(dir.path).filter((f) => f.endsWith(".yaml"));
    for (const file of files) {
      const name = basename(file, ".yaml");
      if (seen.has(name)) continue;
      seen.add(name);

      const filePath = resolve(dir.path, file);
      const content = readFileSync(filePath, "utf-8");

      // Extract description from YAML — matches bash grep/sed behavior exactly
      // (does NOT strip quotes, to produce identical output)
      const descMatch = content.match(/^description:\s*(.+)$/m);
      const desc = descMatch ? descMatch[1].trim() : "";

      const suffix = dir.isUser ? " [user]" : "";
      const paddedName = name.padEnd(20);
      console.log(`  ${paddedName} ${desc}${suffix}`);
    }
  }
}
