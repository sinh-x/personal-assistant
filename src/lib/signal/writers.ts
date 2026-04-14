/**
 * Output writers for the Signal note router.
 *
 * Each destination type has a writer that saves content to the appropriate location.
 * Uses Logseq-friendly outliner format for the learning-management repo.
 */

import {
  writeFileSync,
  appendFileSync,
  existsSync,
  mkdirSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { RoutingResult } from "./types.js";
import { TicketStore } from "../tickets/store.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const LEARNING_REPO = join(
  homedir(),
  "git-repos/sinh-x/tools/learning-management"
);
const JOURNALS_DIR = join(LEARNING_REPO, "journals");
const SIGNAL_BASE = join(homedir(), "Documents/ai-usage/signal");
const SENSITIVE_DIR = join(SIGNAL_BASE, "sensitive");
const YOUTUBE_QUEUE = join(
  homedir(),
  "Documents/ai-usage/queue/youtube-video-queue.txt"
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Format date as YYYY_MM_DD for Logseq journal filenames. */
function journalFilename(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}_${m}_${d}.md`;
}

/** Format time as HH:MM for log entries. */
function timeStr(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${min}`;
}

/** Format date as YYYY-MM-DD for non-journal files. */
function dateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Append a Logseq outliner block to a daily journal file.
 * Creates the file with an empty first block if it doesn't exist.
 */
function appendToJournal(date: Date, block: string): string {
  ensureDir(JOURNALS_DIR);
  const filePath = join(JOURNALS_DIR, journalFilename(date));

  if (!existsSync(filePath)) {
    writeFileSync(filePath, "-\n", "utf-8");
  }

  appendFileSync(filePath, block + "\n", "utf-8");
  return filePath;
}

// ---------------------------------------------------------------------------
// Writers
// ---------------------------------------------------------------------------

export interface WriteResult {
  destination: string;
  path: string;
  ticketId?: string;
}

/**
 * Write a routed message to its destination.
 * Returns info about where the content was saved.
 */
export function writeRoutedMessage(
  result: RoutingResult,
  sentAt: number,
): WriteResult {
  const date = new Date(sentAt);

  switch (result.destination) {
    case "ticket-idea":
      return writeTicket(result, "idea", "low");

    case "ticket-task":
      return writeTicket(result, "task", "medium");

    case "ticket-buy":
      return writeTicket(result, "task", "medium", ["category:shopping"]);

    case "youtube-queue":
      return writeYoutubeQueue(result, date);

    case "spike-queue":
      return writeSpikeQueue(result, date);

    case "bookmark":
      return writeBookmark(result, date);

    case "sensitive":
      return writeSensitive(result, date);

    case "daily-log":
      return writeDailyLog(result, date);

    case "attachment-only":
      return writeAttachmentLog(result, date);

    default:
      return writeDailyLog(result, date);
  }
}

function writeTicket(
  result: RoutingResult,
  type: "idea" | "task",
  priority: "low" | "medium",
  extraTags: string[] = [],
): WriteResult {
  const store = new TicketStore();
  const title = result.content.slice(0, 60) || "Signal note";

  const summaryParts = [result.content];
  if (result.attachmentPaths.length > 0) {
    summaryParts.push("\n## Attachments");
    for (const p of result.attachmentPaths) {
      summaryParts.push(`- ${p}`);
    }
  }

  const ticket = store.create(
    {
      project: "pa",
      title,
      summary: summaryParts.join("\n"),
      description: "",
      status: "idea",
      priority,
      type,
      assignee: "sinh",
      estimate: "M" as "M",
      tags: ["source:signal", ...extraTags],
      blockedBy: [],
      doc_refs: [],
      comments: [],
      from: "",
      to: "",
    },
    "pa-signal-collector",
  );

  return {
    destination: `ticket (${type})`,
    path: ticket.id,
    ticketId: ticket.id,
  };
}

function writeYoutubeQueue(result: RoutingResult, date: Date): WriteResult {
  const url = result.detectedUrl ?? result.content.trim();

  // Append to existing ai-usage YouTube queue (learner team reads this)
  if (existsSync(YOUTUBE_QUEUE)) {
    appendFileSync(YOUTUBE_QUEUE, `${url}\n`, "utf-8");
  }

  // Also log to Logseq journal
  const block = `- #signal #youtube ${url}`;
  const journalPath = appendToJournal(date, block);

  return { destination: "youtube-queue", path: journalPath };
}

function writeSpikeQueue(result: RoutingResult, date: Date): WriteResult {
  const url = result.detectedUrl ?? result.content.trim();
  const block = `- #signal #toread ${url}`;
  const journalPath = appendToJournal(date, block);
  return { destination: "spike-queue", path: journalPath };
}

function writeBookmark(result: RoutingResult, date: Date): WriteResult {
  const url = result.detectedUrl ?? result.content.trim();
  const block = `- #signal #bookmark ${url}`;
  const journalPath = appendToJournal(date, block);
  return { destination: "bookmark", path: journalPath };
}

function writeSensitive(result: RoutingResult, date: Date): WriteResult {
  ensureDir(SENSITIVE_DIR);
  const filePath = join(SENSITIVE_DIR, `${dateStr(date)}.log`);

  const entry = `[${timeStr(date)}] ${result.content}\n`;
  appendFileSync(filePath, entry, "utf-8");

  // Restrict permissions (owner-only read/write)
  chmodSync(filePath, 0o600);

  return { destination: "sensitive", path: filePath };
}

function writeDailyLog(result: RoutingResult, date: Date): WriteResult {
  const content = result.content || "(empty)";
  const block = `- #signal ${content}`;
  const journalPath = appendToJournal(date, block);
  return { destination: "daily-log", path: journalPath };
}

function writeAttachmentLog(result: RoutingResult, date: Date): WriteResult {
  const attachList = result.attachmentPaths
    .map((p) => `\n  - ${p}`)
    .join("");
  const block = `- #signal #attachment (attachment-only)${attachList}`;
  const journalPath = appendToJournal(date, block);
  return { destination: "attachment-only", path: journalPath };
}
