import { createInterface } from "node:readline";
import { TicketStore } from "../lib/tickets/store.js";
import { selectProject } from "../lib/interactive.js";

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

/** Prompt with fallback for empty input */
function makePrompt(nextLine: () => Promise<string>) {
  return async (question: string, fallback = ""): Promise<string> => {
    process.stdout.write(question);
    const answer = await nextLine();
    return answer.trim() || fallback;
  };
}

interface CollectedData {
  title: string;
  summary: string;
  tags: string[];
  priority: "low" | "medium" | "high";
  estimate: "XS" | "S" | "M" | "L" | "XL";
}

async function collectBug(prompt: ReturnType<typeof makePrompt>): Promise<CollectedData> {
  const title = await prompt("Title: ");
  const component = await prompt("Affected component: ");
  const steps = await prompt("Steps to reproduce: ");
  const expected = await prompt("Expected behavior: ");
  const actual = await prompt("Actual behavior: ");
  console.log("Severity: low | medium | high | critical");
  const severity = await prompt("Severity: ", "medium");

  const summary = [
    "## Component",
    component || "_(not specified)_",
    "",
    "## Severity",
    severity,
    "",
    "## Steps to Reproduce",
    steps || "_(not specified)_",
    "",
    "## Expected Behavior",
    expected || "_(not specified)_",
    "",
    "## Actual Behavior",
    actual || "_(not specified)_",
  ].join("\n");

  const priority = severity === "high" || severity === "critical" ? "high" : "medium";

  return {
    title,
    summary,
    tags: [`report-type:bug`, `severity:${severity}`],
    priority,
    estimate: "S",
  };
}

async function collectFeature(prompt: ReturnType<typeof makePrompt>): Promise<CollectedData> {
  const title = await prompt("Title: ");
  const what = await prompt("What (describe the feature): ");
  const why = await prompt("Why (why this matters): ");
  const who = await prompt("Who benefits: ");
  console.log("Effort: S | M | L | XL");
  const effort = await prompt("Effort: ", "M");

  const summary = [
    "## What",
    what || "_(not specified)_",
    "",
    "## Why",
    why || "_(not specified)_",
    "",
    "## Who Benefits",
    who || "_(not specified)_",
  ].join("\n");

  return {
    title,
    summary,
    tags: ["report-type:feature"],
    priority: "medium",
    estimate: effort as "XS" | "S" | "M" | "L" | "XL",
  };
}

async function collectAgent(prompt: ReturnType<typeof makePrompt>): Promise<CollectedData> {
  const agentName = await prompt("Agent name: ");
  const team = await prompt("Team: ");
  const deployId = await prompt("Deployment ID (Enter to skip): ") || "(not specified)";
  console.log("Report type: missing-tool | bug-in-skill | workflow-issue | other");
  const reportType = await prompt("Report type: ", "other");
  const what = await prompt("What happened: ");
  const fix = await prompt("Suggested fix: ");

  const summary = [
    "## Agent",
    agentName,
    "",
    "## Team",
    team,
    "",
    "## Deployment ID",
    deployId,
    "",
    "## Report Type",
    reportType,
    "",
    "## What Happened",
    what || "_(not specified)_",
    "",
    "## Suggested Fix",
    fix || "_(not specified)_",
  ].join("\n");

  return {
    title: `${agentName} — ${reportType}`,
    summary,
    tags: ["report-type:agent", `report-type:${reportType}`],
    priority: "medium",
    estimate: "S",
  };
}

async function collectFeedback(prompt: ReturnType<typeof makePrompt>): Promise<CollectedData> {
  const target = await prompt("Target (deployment ID or team name): ");
  console.log("Rating: good | ok | bad");
  const rating = await prompt("Rating: ", "ok");
  const worked = await prompt("What worked: ");
  const didnt = await prompt("What didn't work: ");
  const suggestions = await prompt("Suggestions: ");

  const summary = [
    "## Target",
    target,
    "",
    "## Rating",
    rating,
    "",
    "## What Worked",
    worked || "_(none)_",
    "",
    "## What Didn't Work",
    didnt || "_(none)_",
    "",
    "## Suggestions",
    suggestions || "_(none)_",
  ].join("\n");

  return {
    title: target,
    summary,
    tags: ["report-type:feedback"],
    priority: "medium",
    estimate: "S",
  };
}

/**
 * Submit a structured report (bug / feature / agent / feedback).
 * Creates a ticket instead of writing to a file.
 */
export async function reportCommand(): Promise<void> {
  const store = new TicketStore();

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const nextLine = createLineQueue(rl);
  const prompt = makePrompt(nextLine);

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

  let data: CollectedData;
  if (type === "bug") data = await collectBug(prompt);
  else if (type === "feature") data = await collectFeature(prompt);
  else if (type === "agent") data = await collectAgent(prompt);
  else data = await collectFeedback(prompt);

  rl.close();

  // Detect or select project
  let projectKey: string;
  try {
    const selected = await selectProject();
    projectKey = selected.key;
  } catch {
    console.error("Error: Could not determine project. Exiting.");
    process.exit(1);
  }

  // Map report type to ticket type
  const ticketType: Record<ReportType, string> = {
    bug: "bug",
    feature: "feature",
    agent: "task",
    feedback: "task",
  };

  // Create the ticket
  const ticket = store.create(
    {
      project: projectKey,
      title: data.title,
      summary: data.summary,
      description: "",
      status: "idea",
      priority: data.priority,
      type: ticketType[type] as "bug" | "feature" | "task",
      assignee: "sinh",
      estimate: data.estimate,
      from: "",
      to: "",
      tags: data.tags,
      blockedBy: [],
      doc_refs: [],
      comments: [],
    },
    "pa-report"
  );

  console.log("");
  console.log(`Created: ${ticket.id}`);
}
