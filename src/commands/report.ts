import { createInterface } from "node:readline";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

const REPORTS_DIR = resolve(homedir(), "Documents/ai-usage/sinh-inputs/reports");

const REPORT_TYPES = ["bug", "feature", "agent", "feedback"] as const;
type ReportType = (typeof REPORT_TYPES)[number];

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

function makePrompt(nextLine: () => Promise<string>) {
  return async (question: string, fallback = ""): Promise<string> => {
    process.stdout.write(question);
    const answer = await nextLine();
    return answer.trim() || fallback;
  };
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-/, "")
    .replace(/-$/, "")
    .slice(0, 50);
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatTimestamp(d: Date): string {
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${formatDate(d)} ${h}:${min}`;
}

function uniqueFilename(dir: string, base: string): string {
  const filename = `${base}.md`;
  if (!existsSync(resolve(dir, filename))) return filename;
  let counter = 2;
  while (existsSync(resolve(dir, `${base}-${counter}.md`))) counter++;
  return `${base}-${counter}.md`;
}

interface ReportData {
  title: string;
  slug: string;
  extraMeta: string;
  body: string;
}

async function collectBug(prompt: ReturnType<typeof makePrompt>): Promise<ReportData> {
  const title = await prompt("Title: ");
  const component = await prompt("Affected component: ");
  const steps = await prompt("Steps to reproduce: ");
  const expected = await prompt("Expected behavior: ");
  const actual = await prompt("Actual behavior: ");
  console.log("Severity: low | medium | high | critical");
  const severity = await prompt("Severity: ", "medium");
  return {
    title,
    slug: slugify(title),
    extraMeta: `> **Component:** ${component}\n> **Severity:** ${severity}`,
    body: `## Steps to Reproduce\n${steps || "_(not specified)_"}\n\n## Expected\n${expected || "_(not specified)_"}\n\n## Actual\n${actual || "_(not specified)_"}`,
  };
}

async function collectFeature(prompt: ReturnType<typeof makePrompt>): Promise<ReportData> {
  const title = await prompt("Title: ");
  const what = await prompt("What (describe the feature): ");
  const why = await prompt("Why (why this matters): ");
  const who = await prompt("Who benefits: ");
  console.log("Effort: S | M | L | XL");
  const effort = await prompt("Effort: ", "M");
  return {
    title,
    slug: slugify(title),
    extraMeta: `> **Effort:** ${effort}`,
    body: `## What\n${what || "_(not specified)_"}\n\n## Why\n${why || "_(not specified)_"}\n\n## Who Benefits\n${who || "_(not specified)_"}`,
  };
}

async function collectAgent(prompt: ReturnType<typeof makePrompt>): Promise<ReportData> {
  const agentName = await prompt("Agent name: ");
  const team = await prompt("Team: ");
  const deployId = await prompt("Deployment ID (Enter to skip): ") || "(not specified)";
  console.log("Report type: missing-tool | bug-in-skill | workflow-issue | other");
  const reportType = await prompt("Report type: ", "other");
  const what = await prompt("What happened: ");
  const fix = await prompt("Suggested fix: ");
  return {
    title: `${agentName} — ${reportType}`,
    slug: slugify(`${agentName}-${reportType}`),
    extraMeta: `> **Agent:** ${agentName}\n> **Team:** ${team}\n> **Deployment:** ${deployId}\n> **Report type:** ${reportType}`,
    body: `## What Happened\n${what || "_(not specified)_"}\n\n## Suggested Fix\n${fix || "_(not specified)_"}`,
  };
}

async function collectFeedback(prompt: ReturnType<typeof makePrompt>): Promise<ReportData> {
  const target = await prompt("Target (deployment ID or team name): ");
  console.log("Rating: good | ok | bad");
  const rating = await prompt("Rating: ", "ok");
  const worked = await prompt("What worked: ");
  const didnt = await prompt("What didn't work: ");
  const suggestions = await prompt("Suggestions: ");
  return {
    title: target,
    slug: slugify(target),
    extraMeta: `> **Target:** ${target}\n> **Rating:** ${rating}`,
    body: `## What Worked\n${worked || "_(none)_"}\n\n## What Didn't Work\n${didnt || "_(none)_"}\n\n## Suggestions\n${suggestions || "_(none)_"}`,
  };
}

const TYPE_LABEL: Record<ReportType, string> = {
  bug: "Bug Report",
  feature: "Feature Request",
  agent: "Agent Self-Report",
  feedback: "Feedback",
};

/**
 * Submit a structured report (bug / feature / agent / feedback).
 */
export async function reportCommand(): Promise<void> {
  mkdirSync(REPORTS_DIR, { recursive: true });

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const nextLine = createLineQueue(rl);
  const prompt = makePrompt(nextLine);

  const now = new Date();
  const today = formatDate(now);
  const timestamp = formatTimestamp(now);

  console.log("=== Submit a Report ===");
  console.log("");
  console.log(`Types: ${REPORT_TYPES.join(" | ")}`);
  const type = (await prompt("Type: ")) as ReportType;

  if (!REPORT_TYPES.includes(type)) {
    console.error(`Error: Unknown type "${type}". Must be: ${REPORT_TYPES.join(" | ")}`);
    rl.close();
    process.exit(1);
  }

  console.log("");

  let data: ReportData;
  if (type === "bug") data = await collectBug(prompt);
  else if (type === "feature") data = await collectFeature(prompt);
  else if (type === "agent") data = await collectAgent(prompt);
  else data = await collectFeedback(prompt);

  rl.close();

  const content = `# ${TYPE_LABEL[type]}: ${data.title}

> **Date:** ${timestamp}
> **Type:** ${type}
> **Status:** new
${data.extraMeta}

${data.body}
`;

  const base = `${today}-${type}-${data.slug}`;
  const filename = uniqueFilename(REPORTS_DIR, base);
  const filePath = resolve(REPORTS_DIR, filename);
  writeFileSync(filePath, content);

  console.log("");
  console.log(`Saved: ${REPORTS_DIR}/${filename}`);
}
