/**
 * Output writers for the Signal note router.
 *
 * Each destination type has a writer that saves content to the appropriate location.
 * Uses Logseq-friendly outliner format for the learning-management repo.
 */

import {
  writeFileSync,
  readFileSync,
  readdirSync,
  appendFileSync,
  existsSync,
  mkdirSync,
  chmodSync,
  unlinkSync,
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
const PAGES_DIR = join(LEARNING_REPO, "pages");
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
// Cleanup (for reprocessing)
// ---------------------------------------------------------------------------

/**
 * Remove all #signal entries from Logseq journal files.
 * Used before reprocessing to avoid duplicates.
 * Also clears the sensitive log file.
 */
export function cleanSignalEntries(): number {
  let cleaned = 0;

  // Clean journal files
  if (existsSync(JOURNALS_DIR)) {
    const files = readdirSync(JOURNALS_DIR).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      const filePath = join(JOURNALS_DIR, file);
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n");

      const filtered: string[] = [];
      let skipIndented = false;

      for (const line of lines) {
        // Check if this is a #signal top-level block
        if (line.startsWith("- #signal ")) {
          skipIndented = true;
          cleaned++;
          continue;
        }
        // Skip indented children of a #signal block
        if (skipIndented && line.startsWith("  - ")) {
          continue;
        }
        skipIndented = false;
        filtered.push(line);
      }

      // Write back if anything changed
      if (filtered.length < lines.length) {
        const result = filtered.join("\n");
        // If only empty first block remains, remove the file
        if (result.trim() === "-" || result.trim() === "") {
          unlinkSync(filePath);
        } else {
          writeFileSync(filePath, result, "utf-8");
        }
      }
    }
  }

  // Clean sensitive log files
  if (existsSync(SENSITIVE_DIR)) {
    const files = readdirSync(SENSITIVE_DIR).filter((f) => f.endsWith(".log"));
    for (const file of files) {
      unlinkSync(join(SENSITIVE_DIR, file));
    }
  }

  // Clean signal pages
  const signalPagesDir = join(PAGES_DIR, "signal");
  if (existsSync(signalPagesDir)) {
    const pages = readdirSync(signalPagesDir).filter((f) => f.endsWith(".md"));
    for (const file of pages) {
      unlinkSync(join(signalPagesDir, file));
      cleaned++;
    }
  }

  return cleaned;
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

  return writeMediaEntry(result, date, "youtube", url);
}

function writeSpikeQueue(result: RoutingResult, date: Date): WriteResult {
  const url = result.detectedUrl ?? result.content.trim();
  return writeMediaEntry(result, date, "article", url);
}

/**
 * Create a structured Logseq page + PA ticket for YouTube/article URLs.
 * Page goes to pages/signal/<slug>.md with Logseq properties.
 * Ticket goes to pending-approval for processing.
 * Journal entry links to both.
 */
function writeMediaEntry(
  _result: RoutingResult,
  date: Date,
  mediaType: "youtube" | "article",
  url: string,
): WriteResult {
  const ds = dateStr(date);
  const slug = urlToSlug(url);
  const pageName = `signal/${ds}-${slug}`;
  const pageDir = join(PAGES_DIR, "signal");
  const pagePath = join(pageDir, `${ds}-${slug}.md`);

  // Create LM ticket
  const store = new TicketStore();
  const tagLabel = mediaType === "youtube" ? "#youtube" : "#article";
  const ticket = store.create(
    {
      project: "lm",
      title: `${mediaType === "youtube" ? "Watch" : "Read"}: ${url.slice(0, 50)}`,
      summary: `${mediaType === "youtube" ? "YouTube video" : "Article"} from Signal Note to Self.\n\nURL: ${url}\nLogseq page: [[${pageName}]]`,
      description: "",
      status: "pending-approval",
      priority: "low",
      type: "task",
      assignee: "sinh",
      estimate: "S" as "S",
      tags: ["source:signal", `category:${mediaType}`],
      blockedBy: [],
      doc_refs: [],
      comments: [],
      from: "",
      to: "",
    },
    "pa-signal-collector",
  );

  // Create Logseq page with properties
  ensureDir(pageDir);
  const pageContent = [
    `type:: ${mediaType}`,
    `url:: ${url}`,
    `source:: signal`,
    `status:: pending`,
    `ticket:: ${ticket.id}`,
    `date:: ${ds}`,
    "",
    `- ${tagLabel} ${url}`,
    `- ticket: ${ticket.id}`,
    "",
  ].join("\n");

  writeFileSync(pagePath, pageContent, "utf-8");

  // Journal entry linking to page + ticket
  const block = `- #signal ${tagLabel} [[${pageName}]] (${ticket.id})`;
  appendToJournal(date, block);

  return {
    destination: `${mediaType}-page`,
    path: pagePath,
    ticketId: ticket.id,
  };
}

/** Convert a URL to a filesystem-safe slug. */
function urlToSlug(url: string): string {
  return url
    .replace(/^https?:\/\//, "")
    .replace(/[^a-zA-Z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
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
  const count = result.attachmentPaths.length;
  const block = `- #signal #attachment ${count} file(s) — encrypted Signal attachment(s), review in Signal Desktop`;
  const journalPath = appendToJournal(date, block);
  return { destination: "attachment-only", path: journalPath };
}
