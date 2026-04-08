import { createInterface } from "node:readline";
import { resolveProjectFromCwd, listRepos } from "./repos.js";

/**
 * Create a line queue from a readline interface.
 * Works correctly in both TTY (interactive) and piped (non-interactive) modes.
 * rl.question() with promises fails in piped mode because 'line' events fire
 * before the next question's listener is set up. This queue captures all lines
 * eagerly so they're available when nextLine() is called.
 */
function createLineQueue(rl: ReturnType<typeof createInterface>): () => Promise<string> {
  const buffer: string[] = [];
  const waiting: Array<(line: string) => void> = [];

  rl.on("line", (line) => {
    if (waiting.length > 0) {
      waiting.shift()!(line);
    } else {
      buffer.push(line);
    }
  });

  return (): Promise<string> => {
    if (buffer.length > 0) {
      return Promise.resolve(buffer.shift()!);
    }
    return new Promise((resolve) => waiting.push(resolve));
  };
}

/**
 * Interactively select a project, with automatic CWD detection as the first choice.
 *
 * 1. Try resolveProjectFromCwd() — if found, announce it and return immediately
 * 2. Otherwise, list all repos with prefixes as a numbered list,
 *    prompt for a selection, and return the chosen repo entry
 */
export async function selectProject(): Promise<{ key: string; prefix: string; path: string }> {
  // Step 1: Try CWD detection first
  const cwd = resolveProjectFromCwd();
  if (cwd) {
    console.log(`Detected project: ${cwd.key}`);
    console.log("");
    return { key: cwd.key, prefix: cwd.prefix, path: "" };
  }

  // Step 2: Show numbered list of all repos with prefixes
  const repos = listRepos().filter((r) => r.prefix);
  if (repos.length === 0) {
    throw new Error("No registered repos found in repos.yaml");
  }

  console.log("Select a project:");
  console.log("");
  repos.forEach((repo, i) => {
    console.log(`  ${i + 1}. ${repo.name} (${repo.prefix}) — ${repo.path}`);
  });
  console.log("");

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const nextLine = createLineQueue(rl);

  let selection: number | undefined;
  while (selection === undefined) {
    const input = await nextLine();
    const num = parseInt(input.trim(), 10);
    if (num >= 1 && num <= repos.length) {
      selection = num;
    } else {
      console.log(`Invalid selection. Enter a number between 1 and ${repos.length}:`);
    }
  }

  rl.close();
  const chosen = repos[selection - 1];
  return { key: chosen.name, prefix: chosen.prefix!, path: chosen.path };
}
