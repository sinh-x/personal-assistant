/**
 * pa signal collect - Signal Note to Self message collector.
 *
 * Extracts new messages from Signal Desktop's "Note to Self" conversation
 * and saves them as raw markdown notes in ~/Documents/ai-usage/signal/raw/.
 *
 * Supports --dry-run to preview without saving.
 */

import { Command } from "commander";
import {
  getOwnIdentity,
  findNoteToSelfConversation,
  extractNotesSinceLastRun,
  readCollectorState,
  ensureSignalFolderStructure,
} from "../lib/signal/reader.js";

export function createSignalCommand(): Command {
  const cmd = new Command("signal");
  cmd.description("Signal Note to Self collector commands");

  const collect = new Command("collect");
  collect
    .description("Extract new Note to Self messages and save as raw notes")
    .option(
      "--dry-run",
      "Show what would be extracted without creating files or updating state",
      false
    )
    .action(async (opts: { dryRun: boolean }) => {
      await runCollect(opts.dryRun);
    });

  cmd.addCommand(collect);
  return cmd;
}

async function runCollect(dryRun: boolean): Promise<void> {
  console.log("=== Signal Note to Self Collector ===\n");

  if (dryRun) {
    console.log("[DRY RUN] No files will be created or modified.\n");
  }

  // Read current state
  const state = readCollectorState();
  console.log(`Last processed: ${state.lastProcessedAt > 0 ? new Date(state.lastProcessedAt).toISOString() : "never"}`);
  console.log(`Total processed: ${state.totalProcessed}`);
  console.log("");

  // Ensure folder structure exists (for state.json at minimum)
  if (!dryRun) {
    ensureSignalFolderStructure();
  }

  // Read Signal identity
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

  // Find Note to Self conversation
  const conversation = findNoteToSelfConversation(identity);
  if (!conversation) {
    console.error("Error: Could not find Note to Self conversation.");
    console.error("Make sure you have sent at least one Note to Self message.");
    process.exit(1);
  }
  console.log(`Note to Self conversation: ${conversation.id}`);
  console.log("");

  // Extract messages
  if (dryRun) {
    // In dry-run mode, just read the messages without saving
    const { fetchNotesSince } = await import("../lib/signal/reader.js");
    const messages = fetchNotesSince(conversation.id, state.lastProcessedAt);
    if (messages.length === 0) {
      console.log("No new messages found.");
    } else {
      console.log(`Found ${messages.length} new message(s):\n`);
      for (const msg of messages) {
        const preview = msg.body
          ? msg.body.slice(0, 80).replace(/\n/g, " ") + (msg.body.length > 80 ? "..." : "")
          : "(no text body)";
        console.log(`  [${new Date(msg.sent_at).toISOString()}] ${preview}`);
        if (msg.hasAttachments > 0) {
          console.log(`    + ${msg.hasAttachments} attachment(s)`);
        }
      }
    }
  } else {
    // Actual extraction
    try {
      const result = extractNotesSinceLastRun(conversation.id);
      if (result.count === 0) {
        console.log("No new messages found.");
      } else {
        console.log(`Extracted ${result.count} new message(s):\n`);
        for (const file of result.files) {
          console.log(`  ${file}`);
        }
      }

      // Show updated state
      const newState = readCollectorState();
      console.log("");
      console.log(`Updated state: lastProcessedAt=${newState.lastProcessedAt}`);
      console.log(`Total processed: ${newState.totalProcessed}`);
    } catch (err) {
      console.error("Error during extraction:");
      console.error((err as Error).message);
      process.exit(1);
    }
  }
}