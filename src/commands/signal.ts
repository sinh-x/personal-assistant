/**
 * pa signal collect - Signal Note to Self message collector.
 *
 * Extracts new messages from Signal Desktop's "Note to Self" conversation,
 * routes them via rule-based tag/URL/sensitive detection, and saves to
 * appropriate destinations (Logseq journal, PA tickets, sensitive file, queues).
 *
 * Supports --dry-run to preview without writing, --reprocess to re-route existing raw notes.
 */

import { Command } from "commander";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  getOwnIdentity,
  findNoteToSelfConversation,
  extractNotesSinceLastRun,
  readCollectorState,
  ensureSignalFolderStructure,
} from "../lib/signal/reader.js";
import { routeMessage } from "../lib/signal/router.js";
import { writeRoutedMessage, cleanSignalEntries } from "../lib/signal/writers.js";
import { markAsProcessed } from "../lib/signal/classifier.js";
import type { SignalConversation } from "../lib/signal/types.js";

const SIGNAL_RAW_DIR = join(homedir(), "Documents/ai-usage/signal/raw");

export function createSignalCommand(): Command {
  const cmd = new Command("signal");
  cmd.description("Signal Note to Self collector commands");

  const collect = new Command("collect");
  collect
    .description("Extract and route Note to Self messages (rule-based, no AI)")
    .option(
      "--dry-run",
      "Show what would be extracted and routed without writing anything",
      false,
    )
    .option(
      "--skip-route",
      "Extract raw notes but skip routing (for testing extraction only)",
      false,
    )
    .option(
      "--reprocess",
      "Re-route all existing raw/ messages through the new router",
      false,
    )
    .option(
      "--conversation-id <id>",
      "Override Note to Self conversation ID (debug/override)",
    )
    .action(
      async (opts: {
        dryRun: boolean;
        skipRoute: boolean;
        reprocess: boolean;
        conversationId?: string;
      }) => {
        if (opts.reprocess) {
          await runReprocess(opts.dryRun);
        } else {
          await runCollect(opts.dryRun, opts.skipRoute, opts.conversationId);
        }
      },
    );

  cmd.addCommand(collect);
  return cmd;
}

async function runCollect(
  dryRun: boolean,
  skipRoute: boolean,
  conversationIdOverride?: string,
): Promise<void> {
  console.log("=== Signal Note to Self Collector ===\n");

  if (dryRun) {
    console.log(
      "[DRY RUN] No files will be created, no tickets created, state not updated.\n",
    );
  }

  const state = readCollectorState();
  console.log(
    `Last processed: ${state.lastProcessedAt > 0 ? new Date(state.lastProcessedAt).toISOString() : "never"}`,
  );
  console.log(`Total processed: ${state.totalProcessed}`);
  console.log("");

  if (!dryRun) {
    ensureSignalFolderStructure();
  }

  // Find Note to Self conversation
  let conversation: SignalConversation | null = null;

  if (conversationIdOverride) {
    conversation = {
      id: conversationIdOverride,
      type: "private",
      name: null,
      profileName: null,
      profileFullName: null,
      e164: null,
      serviceId: null,
      active_at: null,
    };
    console.log(`Note to Self conversation: ${conversation.id} (override)`);
  } else {
    let identity;
    try {
      identity = getOwnIdentity();
      console.log(`Own identity: ${identity.e164} (${identity.uuid})`);
    } catch (err) {
      console.error("Error: Could not read Signal identity from DB.");
      console.error("Is Signal Desktop installed and synced?");
      console.error("");
      console.error((err as Error).message);
      process.exit(1);
    }

    conversation = findNoteToSelfConversation(identity);
    if (!conversation) {
      console.error("Error: Could not find Note to Self conversation.");
      console.error(
        "Make sure you have sent at least one Note to Self message.",
      );
      process.exit(1);
    }
    console.log(`Note to Self conversation: ${conversation.id}`);
  }
  console.log("");

  if (dryRun) {
    // Preview extraction + routing
    const { fetchNotesSince } = await import("../lib/signal/reader.js");
    const messages = fetchNotesSince(conversation.id, state.lastProcessedAt);
    if (messages.length === 0) {
      console.log("No new messages found.");
    } else {
      console.log(`Would extract ${messages.length} new message(s):\n`);
      for (const msg of messages) {
        const preview = msg.body
          ? msg.body.slice(0, 80).replace(/\n/g, " ") +
            (msg.body.length > 80 ? "..." : "")
          : "(no text body)";
        console.log(`  [${new Date(msg.sent_at).toISOString()}] ${preview}`);
        if (msg.hasAttachments > 0) {
          console.log(`    + ${msg.hasAttachments} attachment(s)`);
        }
      }
    }
  } else {
    // Extract
    let extractedFiles: string[] = [];
    try {
      const result = extractNotesSinceLastRun(conversation.id);
      if (result.count === 0) {
        console.log("No new messages found.");
      } else {
        console.log(`Extracted ${result.count} new message(s):\n`);
        for (const file of result.files) {
          console.log(`  ${file}`);
        }
        extractedFiles = result.files;
      }

      const newState = readCollectorState();
      console.log("");
      console.log(`Updated state: lastProcessedAt=${newState.lastProcessedAt}`);
      console.log(`Total processed: ${newState.totalProcessed}`);
    } catch (err) {
      console.error("Error during extraction:");
      console.error((err as Error).message);
      process.exit(1);
    }

    // Route extracted notes
    if (!skipRoute && extractedFiles.length > 0) {
      console.log("\n=== Routing ===\n");
      routeFiles(extractedFiles);
    }
  }
}

/**
 * Reprocess all existing raw/ messages through the router.
 * Useful for migrating old messages to the new routing system.
 */
async function runReprocess(dryRun: boolean): Promise<void> {
  console.log("=== Reprocessing existing raw notes ===\n");

  if (!readdirSync(SIGNAL_RAW_DIR).length) {
    console.log("No raw notes found in signal/raw/.");
    return;
  }

  const files = readdirSync(SIGNAL_RAW_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => join(SIGNAL_RAW_DIR, f));

  console.log(`Found ${files.length} raw note(s) to reprocess.\n`);

  if (dryRun) {
    for (const file of files) {
      const result = routeMessage(file);
      const sentAt = extractSentAtFromFile(file);
      const date = new Date(sentAt).toISOString().slice(0, 10);
      console.log(`  [${date}] ${result.destination} ← ${file}`);
    }
    console.log("\n[DRY RUN] No files written.");
  } else {
    // Clean existing #signal entries to avoid duplicates
    console.log("Cleaning previous #signal entries from journals...");
    const cleaned = cleanSignalEntries();
    console.log(`Removed ${cleaned} previous entries.\n`);

    routeFiles(files);
  }
}

/**
 * Route a list of raw note files and write to destinations.
 */
function routeFiles(files: string[]): void {
  let routed = 0;
  let errors = 0;

  for (const file of files) {
    try {
      const result = routeMessage(file);

      // Extract sentAt from filename: YYYY-M-D-H-M-<hash>.md
      const sentAt = extractSentAtFromFile(file);

      const writeResult = writeRoutedMessage(result, sentAt);
      console.log(
        `  ${result.destination.padEnd(16)} → ${writeResult.path}${writeResult.ticketId ? ` (${writeResult.ticketId})` : ""}`,
      );

      markAsProcessed(file);
      routed++;
    } catch (err) {
      console.error(`  ERROR: ${file}: ${(err as Error).message}`);
      errors++;
    }
  }

  console.log(`\nRouted ${routed} note(s). Errors: ${errors}.`);
}

/**
 * Extract sentAt timestamp from raw note frontmatter.
 * Falls back to file modification time if frontmatter parse fails.
 */
function extractSentAtFromFile(filePath: string): number {
  const content = readFileSync(filePath, "utf-8");
  const match = content.match(/^sentAt:\s*(\d+)/m);
  if (match) return parseInt(match[1], 10);
  return Date.now();
}
