/**
 * pa signal collect - Signal Note to Self message collector.
 *
 * Extracts new messages from Signal Desktop's "Note to Self" conversation,
 * classifies them using MiniMax AI, and creates PA tickets.
 *
 * Supports --dry-run to preview without creating tickets.
 */

import { Command } from "commander";
import {
  getOwnIdentity,
  findNoteToSelfConversation,
  extractNotesSinceLastRun,
  readCollectorState,
  ensureSignalFolderStructure,
} from "../lib/signal/reader.js";
import {
  classifyRawNotes,
  markAsProcessed,
  getTicketInputs,
} from "../lib/signal/classifier.js";
import { TicketStore } from "../lib/tickets/store.js";

export function createSignalCommand(): Command {
  const cmd = new Command("signal");
  cmd.description("Signal Note to Self collector commands");

  const collect = new Command("collect");
  collect
    .description("Extract, classify, and create tickets from Note to Self messages")
    .option(
      "--dry-run",
      "Show what would be extracted and classified without creating tickets",
      false
    )
    .option(
      "--skip-classify",
      "Extract raw notes but skip AI classification (for testing extraction)",
      false
    )
    .action(async (opts: { dryRun: boolean; skipClassify: boolean }) => {
      await runCollect(opts.dryRun, opts.skipClassify);
    });

  cmd.addCommand(collect);
  return cmd;
}

async function runCollect(dryRun: boolean, skipClassify: boolean): Promise<void> {
  console.log("=== Signal Note to Self Collector ===\n");

  if (dryRun) {
    console.log("[DRY RUN] No files will be created, no tickets created, state not updated.\n");
  }

  // Read current state
  const state = readCollectorState();
  console.log(`Last processed: ${state.lastProcessedAt > 0 ? new Date(state.lastProcessedAt).toISOString() : "never"}`);
  console.log(`Total processed: ${state.totalProcessed}`);
  console.log("");

  // Ensure folder structure exists
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
    // Dry-run: preview what would be extracted
    const { fetchNotesSince } = await import("../lib/signal/reader.js");
    const messages = fetchNotesSince(conversation.id, state.lastProcessedAt);
    if (messages.length === 0) {
      console.log("No new messages found.");
    } else {
      console.log(`Would extract ${messages.length} new message(s):\n`);
      for (const msg of messages) {
        const preview = msg.body
          ? msg.body.slice(0, 80).replace(/\n/g, " ") + (msg.body.length > 80 ? "..." : "")
          : "(no text body)";
        console.log(`  [${new Date(msg.sent_at).toISOString()}] ${preview}`);
        if (msg.hasAttachments > 0) {
          console.log(`    + ${msg.hasAttachments} attachment(s)`);
        }
      }
      console.log("");
      console.log("Classification preview (using MiniMax AI):");
      console.log("  Each note would be classified as: idea | task | learning | data");
      console.log("  Then a PA ticket would be created with the classified type.");
    }
  } else {
    // Actual extraction
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

    // Phase 3: Classification
    if (!skipClassify && extractedFiles.length > 0) {
      console.log("\n=== Classification ===\n");
      try {
        const classified = await classifyRawNotes();
        console.log(`\nClassified ${classified.length} note(s).\n`);

        // Create tickets
        console.log("=== Ticket Creation ===\n");
        const store = new TicketStore();

        for (const note of classified) {
          const inputs = getTicketInputs(note);
          const ticket = store.create(
            {
              project: inputs.project,
              title: inputs.title,
              summary: inputs.summary,
              description: inputs.description,
              status: inputs.status as "idea",
              priority: inputs.priority as "low" | "medium" | "high",
              type: inputs.type as "idea" | "task",
              assignee: inputs.assignee,
              estimate: inputs.estimate as "XS" | "S" | "M" | "L" | "XL",
              tags: inputs.tags,
              blockedBy: [],
              doc_refs: [],
              comments: [],
              from: "",
              to: "",
            },
            "pa-signal-collector"
          );
          console.log(`  Created ${ticket.id} (${note.classification.type}): ${inputs.title}`);

          // Mark as processed
          markAsProcessed(note.originalPath);
        }

        console.log(`\nCreated ${classified.length} ticket(s).`);
      } catch (err) {
        console.error("Error during classification:");
        console.error((err as Error).message);
        console.error("Raw notes were extracted but not classified.");
      }
    }
  }
}