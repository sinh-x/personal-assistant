import { createInterface } from "node:readline";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

const IDEAS_DIR = resolve(homedir(), "Documents/ai-usage/sinh-inputs/ideas");

/** Prompt user for a line of input */
function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer));
  });
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

/** Generate a URL-safe slug from a title */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-/, "")
    .replace(/-$/, "")
    .slice(0, 50);
}

/** Format date as YYYY-MM-DD */
function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Format date+time as YYYY-MM-DD HH:MM */
function formatTimestamp(d: Date): string {
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${formatDate(d)} ${h}:${min}`;
}

/**
 * Log an idea interactively.
 * Replaces idea.sh (131 lines).
 */
export async function ideaCommand(): Promise<void> {
  mkdirSync(IDEAS_DIR, { recursive: true });

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const now = new Date();
  const timestamp = formatTimestamp(now);
  const today = formatDate(now);

  console.log("=== Log an Idea ===");
  console.log("");

  // Title (required)
  const title = await prompt(rl, "Title: ");
  if (!title) {
    console.error("Error: Title is required.");
    rl.close();
    process.exit(1);
  }

  // Category
  console.log("");
  console.log("Categories: personal | work | volunteer | learning | infra");
  const categoryInput = await prompt(rl, "Category [personal]: ");
  const category = categoryInput || "personal";

  // Effort
  console.log("");
  console.log("Effort: S | M | L | XL");
  const effortInput = await prompt(rl, "Effort [M]: ");
  const effort = effortInput || "M";

  // What
  console.log("");
  const whatInput = await prompt(rl, "What (one-line description): ");
  const what = whatInput || title;

  // Why
  console.log("");
  const why = await prompt(rl, "Why (why this matters): ");

  // Who
  console.log("");
  const whoInput = await prompt(rl, "Who benefits [Sinh]: ");
  const who = whoInput || "Sinh";

  // Notes (multi-line)
  console.log("");
  console.log("Notes (extra context, press Ctrl-D when done, or Enter to skip):");

  // Pause the readline to read raw multi-line input
  rl.pause();
  const notesRl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const notes = await readMultiLine(notesRl);
  notesRl.close();

  // Reopen for tags
  const rl2 = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("");
  const tagsInput = await prompt(rl2, "Tags (space-separated, or Enter to skip): ");
  rl2.close();
  rl.close();

  // Generate filename
  const slug = slugify(title);
  let filename = `${today}-${slug}.md`;

  // Avoid overwriting
  if (existsSync(resolve(IDEAS_DIR, filename))) {
    let counter = 2;
    while (existsSync(resolve(IDEAS_DIR, `${today}-${slug}-${counter}.md`))) {
      counter++;
    }
    filename = `${today}-${slug}-${counter}.md`;
  }

  // Format tags
  let tagsFormatted: string;
  if (tagsInput.trim()) {
    tagsFormatted = tagsInput
      .trim()
      .split(/\s+/)
      .map((t) => `\`${t}\``)
      .join(" ");
  } else {
    tagsFormatted = "(none yet)";
  }

  // Write file
  const content = `# Idea: ${title}

> **Date:** ${timestamp}
> **Category:** ${category}
> **Status:** new
> **Effort:** ${effort}

## What
${what}

## Why
${why || "_(not specified)_"}

## Who
${who}

## Notes
${notes || "_(none)_"}

## Tags
${tagsFormatted}
`;

  const filePath = resolve(IDEAS_DIR, filename);
  writeFileSync(filePath, content);

  console.log("");
  console.log(`Saved: ${IDEAS_DIR}/${filename}`);
}
