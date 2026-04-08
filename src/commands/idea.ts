import { createInterface } from "node:readline";
import { TicketStore } from "../lib/tickets/store.js";
import { selectProject } from "../lib/interactive.js";

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

/** Prompt with fallback for empty input */
function makePrompt(nextLine: () => Promise<string>) {
  return async (question: string, fallback = ""): Promise<string> => {
    process.stdout.write(question);
    const answer = await nextLine();
    return answer.trim() || fallback;
  };
}

/** Read multi-line input until Ctrl-D or empty first line */
function readMultiLine(rl: ReturnType<typeof createInterface>): Promise<string> {
  return new Promise((resolve) => {
    const lines: string[] = [];
    let firstLine = true;

    const onLine = (line: string) => {
      if (firstLine && line === "") {
        rl.removeListener("line", onLine);
        rl.removeListener("close", onClose);
        resolve("");
        return;
      }
      firstLine = false;
      lines.push(line);
    };

    const onClose = () => {
      rl.removeListener("line", onLine);
      resolve(lines.join("\n"));
    };

    rl.on("line", onLine);
    rl.once("close", onClose);
  });
}

/**
 * Log an idea interactively.
 * Replaces file-writing idea.sh (131 lines).
 */
export async function ideaCommand(): Promise<void> {
  const store = new TicketStore();

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const nextLine = createLineQueue(rl);
  const prompt = makePrompt(nextLine);

  console.log("=== Log an Idea ===");
  console.log("");

  // Detect or select project
  let projectKey: string;
  try {
    const selected = await selectProject();
    projectKey = selected.key;
  } catch {
    console.error("Error: Could not determine project. Exiting.");
    rl.close();
    process.exit(1);
  }

  // Title (required)
  const title = await prompt("Title: ");
  if (!title) {
    console.error("Error: Title is required.");
    rl.close();
    process.exit(1);
  }

  // Category
  console.log("");
  console.log("Categories: personal | work | volunteer | learning | infra");
  const category = await prompt("Category [personal]: ", "personal");

  // Effort
  console.log("");
  console.log("Effort: S | M | L | XL");
  const effort = await prompt("Effort [M]: ", "M");

  // What
  console.log("");
  const what = await prompt("What (one-line description): ") || title;

  // Why
  console.log("");
  const why = await prompt("Why (why this matters): ");

  // Who
  console.log("");
  const who = await prompt("Who benefits [Sinh]: ", "Sinh");

  // Notes (multi-line)
  console.log("");
  console.log("Notes (extra context, press Ctrl-D when done, or Enter to skip):");

  let rlClosed = false;
  rl.once("close", () => {
    rlClosed = true;
  });
  const notes = await readMultiLine(rl);

  // Tags — only if rl is still open (not closed by Ctrl-D)
  console.log("");
  let tagsInput = "";
  if (!rlClosed) {
    tagsInput = await prompt("Tags (space-separated, or Enter to skip): ");
    rl.close();
  }

  // Build summary as markdown
  const summary = [
    "## What",
    what,
    "",
    "## Why",
    why || "_(not specified)_",
    "",
    "## Who",
    who,
    "",
    "## Notes",
    notes || "_(none)_",
  ].join("\n");

  // Build tags array
  const tags: string[] = [`category:${category}`];
  if (tagsInput.trim()) {
    tagsInput
      .trim()
      .split(/\s+/)
      .forEach((t) => tags.push(t));
  }

  // Create the ticket
  const ticket = store.create(
    {
      project: projectKey,
      title,
      summary,
      description: "",
      status: "idea",
      priority: "low",
      type: "idea",
      assignee: "sinh",
      estimate: effort as "XS" | "S" | "M" | "L" | "XL",
      from: "",
      to: "",
      tags,
      blockedBy: [],
      doc_refs: [],
      comments: [],
    },
    "pa-idea"
  );

  console.log("");
  console.log(`Created: ${ticket.id}`);
}
