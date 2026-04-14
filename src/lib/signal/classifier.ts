/**
 * Signal note classifier using MiniMax AI provider.
 *
 * Classifies raw Signal notes into categories: idea, task, learning, data.
 * Uses the ANTHROPIC_* environment variables set by PA deploy (provider=minimax).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";

export interface ClassificationResult {
  type: "idea" | "task" | "learning" | "data";
  confidence: number;
  title: string;
  tags: string[];
  priority: "low" | "medium" | "high";
}

export interface ClassifiedNote {
  originalPath: string;
  classification: ClassificationResult;
  classifiedAt: string;
}

// Classification mapping per spec
const CLASSIFICATION_MAP = {
  idea: {
    ticketType: "idea" as const,
    priority: "low" as const,
    assignee: "sinh",
    tags: [] as string[],
  },
  task: {
    ticketType: "task" as const,
    priority: "medium" as const,
    assignee: "sinh",
    tags: [] as string[],
  },
  learning: {
    ticketType: "idea" as const,
    priority: "medium" as const,
    assignee: "sinh",
    tags: ["category:learning"],
  },
  data: {
    ticketType: "task" as const,
    priority: "medium" as const,
    assignee: "sinh",
    tags: ["category:data-processing"],
  },
};

/** Base directory for signal processed notes */
const SIGNAL_BASE_DIR = join(homedir(), "Documents/ai-usage/signal");
const SIGNAL_CLASSIFIED_DIR = join(SIGNAL_BASE_DIR, "classified");
const SIGNAL_PROCESSED_DIR = join(SIGNAL_BASE_DIR, "processed");

/** Ensure directory exists */
function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Extract frontmatter and body from a raw note file.
 */
function parseRawNote(filePath: string): { frontmatter: Record<string, string>; body: string } {
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  const frontmatter: Record<string, string> = {};
  const bodyLines: string[] = [];
  let inFrontmatter = false;
  let bodyStarted = false;

  for (const line of lines) {
    if (line.trim() === "---") {
      if (!inFrontmatter) {
        inFrontmatter = true;
        continue;
      } else {
        inFrontmatter = false;
        bodyStarted = true;
        continue;
      }
    }

    if (bodyStarted || !inFrontmatter) {
      if (bodyStarted) bodyLines.push(line);
    } else {
      const colonIdx = line.indexOf(":");
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        const value = line.slice(colonIdx + 1).trim();
        frontmatter[key] = value;
      }
    }
  }

  return { frontmatter, body: bodyLines.join("\n").trim() };
}

/**
 * Build the classification prompt for MiniMax.
 */
function buildClassificationPrompt(noteBody: string): string {
  return `Classify the following Signal note into exactly one of these categories:

- idea: A concept, suggestion, or inspiration. Something that sparks interest or proposes something new.
- task: An action item or thing to do. Something that requires doing, fixing, or completing.
- learning: Something to learn, study, or explore. Topics, subjects, skills to acquire knowledge about.
- data: Information, reference material, links, or data points. Things to save for later lookup.

Respond with ONLY valid JSON (no markdown, no explanation):
{
  "type": "idea" | "task" | "learning" | "data",
  "confidence": 0.0-1.0,
  "title": "Brief title (max 60 chars)",
  "tags": ["tag1", "tag2"]
}

Note content:
${noteBody.slice(0, 1000)}
`.trim();
}

/**
 * Call MiniMax API via the standard ANTHROPIC_* env var interface.
 * Uses ANTHROPIC_AUTH_TOKEN for API key, ANTHROPIC_BASE_URL for endpoint,
 * and ANTHROPIC_MODEL for the model (MiniMax-M2.7).
 */
async function callMiniMax(prompt: string): Promise<string> {
  const apiKey = process.env["ANTHROPIC_AUTH_TOKEN"];
  const baseUrl = process.env["ANTHROPIC_BASE_URL"] ?? "https://api.minimax.io/anthropic";
  const model = process.env["ANTHROPIC_MODEL"] ?? "MiniMax-M2.7";

  if (!apiKey) {
    throw new Error("ANTHROPIC_AUTH_TOKEN not set — MiniMax API key required for classification");
  }

  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`MiniMax API error ${response.status}: ${errorText}`);
  }

  const data = (await response.json()) as { content?: Array<{ type: string; text?: string }> };
  const text = data.content?.[0]?.text;
  if (!text) {
    throw new Error("Empty response from MiniMax API");
  }

  return text;
}

/**
 * Parse the JSON classification response from MiniMax.
 */
function parseClassificationResponse(jsonStr: string): Omit<ClassificationResult, "priority"> {
  // Strip any markdown code blocks
  const cleaned = jsonStr.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const parsed = JSON.parse(cleaned);

  const type = parsed["type"] as "idea" | "task" | "learning" | "data";
  const confidence = typeof parsed["confidence"] === "number" ? parsed["confidence"] : 0.5;
  const title = typeof parsed["title"] === "string" ? parsed["title"].slice(0, 60) : "Untitled";
  const tags = Array.isArray(parsed["tags"]) ? parsed["tags"] : [];

  return { type, confidence, title, tags };
}

/**
 * Classify a single raw note file.
 */
export async function classifyNote(
  rawFilePath: string,
  timeoutMs = 30_000
): Promise<ClassifiedNote> {
  const { body } = parseRawNote(rawFilePath);

  if (!body.trim()) {
    throw new Error(`Empty note body in ${rawFilePath}`);
  }

  const prompt = buildClassificationPrompt(body);

  // Run with timeout
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("Classification timeout (30s)")), timeoutMs);
  });

  const responsePromise = callMiniMax(prompt);
  const responseText = await Promise.race([responsePromise, timeoutPromise]);

  const parsed = parseClassificationResponse(responseText);

  // Add priority based on type
  const priority = CLASSIFICATION_MAP[parsed.type].priority;

  return {
    originalPath: rawFilePath,
    classification: {
      type: parsed.type,
      confidence: parsed.confidence,
      title: parsed.title,
      tags: parsed.tags,
      priority,
    },
    classifiedAt: new Date().toISOString(),
  };
}

/**
 * Save a classified note to signal/classified/.
 */
function saveClassifiedNote(note: ClassifiedNote): string {
  ensureDir(SIGNAL_CLASSIFIED_DIR);

  const originalBasename = basename(note.originalPath);
  const classifiedFileName = `classified-${originalBasename}`;
  const classifiedPath = join(SIGNAL_CLASSIFIED_DIR, classifiedFileName);

  const content = [
    "---",
    `originalPath: ${note.originalPath}`,
    `type: ${note.classification.type}`,
    `confidence: ${note.classification.confidence}`,
    `title: ${note.classification.title}`,
    `tags: ${JSON.stringify(note.classification.tags)}`,
    `priority: ${note.classification.priority}`,
    `classifiedAt: ${note.classifiedAt}`,
    "---",
    "",
    `## Title`,
    note.classification.title,
    "",
    `## Classification`,
    `Type: ${note.classification.type} (${(note.classification.confidence * 100).toFixed(0)}% confidence)`,
    `Priority: ${note.classification.priority}`,
    note.classification.tags.length > 0 ? `Tags: ${note.classification.tags.join(", ")}` : "",
    "",
    `## Original Content`,
    readFileSync(note.originalPath, "utf-8"),
  ]
    .filter((line) => line !== undefined)
    .join("\n");

  writeFileSync(classifiedPath, content, "utf-8");
  return classifiedPath;
}

/**
 * Move processed raw note to signal/processed/.
 */
export function markAsProcessed(rawFilePath: string): string {
  ensureDir(SIGNAL_PROCESSED_DIR);

  const fileName = basename(rawFilePath);
  const processedPath = join(SIGNAL_PROCESSED_DIR, fileName);

  // Move by reading and writing (simple approach)
  const content = readFileSync(rawFilePath, "utf-8");
  writeFileSync(processedPath, content, "utf-8");

  return processedPath;
}

/**
 * Classify and create tickets for all raw notes in signal/raw/.
 * Returns the list of classified notes (for ticket creation).
 */
export async function classifyRawNotes(): Promise<ClassifiedNote[]> {
  const rawDir = join(SIGNAL_BASE_DIR, "raw");

  if (!existsSync(rawDir)) {
    return [];
  }

  const { readdirSync } = await import("node:fs");
  const files = readdirSync(rawDir).filter((f) => f.endsWith(".md"));

  if (files.length === 0) {
    return [];
  }

  const results: ClassifiedNote[] = [];

  for (const file of files) {
    const rawPath = join(rawDir, file);
    try {
      const classified = await classifyNote(rawPath);
      const classifiedPath = saveClassifiedNote(classified);
      console.log(`Classified: ${file} → ${basename(classifiedPath)} (${classified.classification.type})`);
      results.push(classified);
    } catch (err) {
      console.error(`Failed to classify ${file}: ${(err as Error).message}`);
    }
  }

  return results;
}

/**
 * Get ticket creation params from a classified note.
 * Returns inputs ready for TicketStore.create().
 */
export function getTicketInputs(
  note: ClassifiedNote
): {
  project: string;
  title: string;
  summary: string;
  description: string;
  status: string;
  type: string;
  priority: string;
  assignee: string;
  tags: string[];
  estimate: string;
} {
  const mapping = CLASSIFICATION_MAP[note.classification.type];

  // Build summary from note content
  const { frontmatter, body: bodyContent } = parseRawNote(note.originalPath);

  const summary = [
    `## Signal Note Classification`,
    `Type: ${note.classification.type}`,
    `Confidence: ${(note.classification.confidence * 100).toFixed(0)}%`,
    ``,
    `## Original`,
    bodyContent.slice(0, 500),
  ];

  // Include attachment references if any were copied
  const attachmentsCopiedRaw = frontmatter["attachmentsCopied"];
  if (attachmentsCopiedRaw) {
    try {
      const attachmentPaths = JSON.parse(attachmentsCopiedRaw) as string[];
      if (attachmentPaths.length > 0) {
        summary.push(``, `## Attachments`);
        for (const p of attachmentPaths) {
          summary.push(`- ${p}`);
        }
      }
    } catch {
      // ignore malformed JSON
    }
  }

  return {
    project: "pa",
    title: note.classification.title,
    summary: summary.join("\n"),
    description: "",
    status: "idea",
    type: mapping.ticketType,
    priority: note.classification.priority === "high" ? "high" : mapping.priority === "low" ? "low" : "medium",
    assignee: mapping.assignee,
    tags: [...mapping.tags, ...note.classification.tags],
    estimate: "M",
  };
}