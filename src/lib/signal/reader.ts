/**
 * Signal Desktop SQLCipher DB reader.
 *
 * Read-only access to Signal Desktop database for Note to Self extraction.
 * Uses the `sqlcipher` CLI tool (added to PA's runtimePath via flake.nix).
 *
 * Schema reference (explored 2026-04-13):
 *   - conversations: id, type, e164, serviceId, name, profileFullName, active_at
 *   - messages: id, conversationId, sent_at, body, type, hasAttachments, sourceServiceId
 *   - message_attachments: messageId, contentType, path, fileName, size, duration, attachmentType
 *   - items: id, json — stores own identity (uuid_id, number_id keys)
 *
 * Note to Self identification:
 *   The conversation where e164 / serviceId matches the user's own account identity
 *   (read from items table: uuid_id and number_id).
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";
import { createHash } from "node:crypto";
import type {
  SignalConversation,
  SignalAccountIdentity,
  NoteToSelfMessage,
  AttachmentMeta,
  SignalMessage,
  SignalCollectorState,
} from "./types.js";

// Default paths
const DEFAULT_DB_PATH = join(homedir(), ".config/Signal/sql/db.sqlite");
const DEFAULT_CONFIG_PATH = join(homedir(), ".config/Signal/config.json");
const DEFAULT_ATTACHMENTS_DIR = join(
  homedir(),
  ".config/Signal/attachments.noindex"
);

/**
 * Read the SQLCipher encryption key from Signal's config.json.
 * Returns the raw 64-char hex string (no 'x'' prefix).
 */
export function readSignalKey(configPath = DEFAULT_CONFIG_PATH): string {
  if (!existsSync(configPath)) {
    throw new Error(`Signal config not found: ${configPath}`);
  }
  const raw = readFileSync(configPath, "utf-8");
  const config = JSON.parse(raw) as { key?: string };
  if (!config.key || config.key.length !== 64) {
    throw new Error(
      `Invalid Signal key in config.json (expected 64 hex chars, got ${config.key?.length ?? 0})`
    );
  }
  return config.key;
}

/**
 * Execute one or more SQL statements against the Signal SQLCipher DB.
 * Sets PRAGMA key automatically. Sets busy_timeout for WAL-safe concurrent reads.
 * Returns the raw stdout string.
 *
 * SAFETY: This function is READ-ONLY. Never pass INSERT/UPDATE/DELETE statements.
 */
function querySqlcipher(
  sql: string,
  dbPath = DEFAULT_DB_PATH,
  key?: string
): string {
  const resolvedKey = key ?? readSignalKey();
  // PRAGMA busy_timeout: wait up to 5s for DB lock (Signal Desktop may be writing)
  const input = [
    `PRAGMA key="x'${resolvedKey}'";`,
    "PRAGMA busy_timeout=5000;",
    "PRAGMA journal_mode=WAL;",
    sql,
  ].join("\n");

  const result = execSync(`sqlcipher "${dbPath}"`, {
    input,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 15_000,
  });
  return result;
}

/**
 * Parse sqlcipher pipe-delimited output into rows of fields.
 * Skips 'ok' lines (PRAGMA responses).
 */
function parseRows(output: string): string[][] {
  return output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && l !== "ok")
    .map((l) => l.split("|"));
}

/**
 * Read the local Signal account identity from the `items` table.
 * Returns the own E.164 phone number and ACI UUID.
 */
export function getOwnIdentity(
  dbPath = DEFAULT_DB_PATH,
  key?: string
): SignalAccountIdentity {
  const sql =
    "SELECT id, json FROM items WHERE id IN ('uuid_id', 'number_id') ORDER BY id;";
  const output = querySqlcipher(sql, dbPath, key);
  const rows = parseRows(output);

  let e164 = "";
  let uuid = "";

  for (const row of rows) {
    if (row.length < 2) continue;
    const id = row[0];
    const jsonStr = row.slice(1).join("|");
    try {
      const data = JSON.parse(jsonStr) as { value?: string };
      const value = data.value ?? "";
      if (id === "number_id") {
        // Format: '+84984320253.3' — strip device suffix
        e164 = value.replace(/\.\d+$/, "");
      } else if (id === "uuid_id") {
        // Format: 'xxxxxxxx-...-xxxx.3' — strip device suffix
        uuid = value.replace(/\.\d+$/, "");
      }
    } catch {
      // ignore malformed rows
    }
  }

  if (!e164 || !uuid) {
    throw new Error(
      `Could not read own identity from Signal DB (e164='${e164}', uuid='${uuid}')`
    );
  }
  return { e164, uuid };
}

/**
 * Find the "Note to Self" conversation by matching own account identity.
 * Signal stores Note to Self as a private conversation where serviceId == own ACI UUID.
 * Falls back to e164 match if serviceId lookup fails.
 */
export function findNoteToSelfConversation(
  identity: SignalAccountIdentity,
  dbPath = DEFAULT_DB_PATH,
  key?: string
): SignalConversation | null {
  const sql = `SELECT id, type, name, profileName, profileFullName, e164, serviceId, active_at
    FROM conversations
    WHERE type='private' AND (serviceId='${identity.uuid}' OR e164='${identity.e164}')
    LIMIT 1;`;

  const output = querySqlcipher(sql, dbPath, key);
  const rows = parseRows(output);

  if (rows.length === 0) return null;

  const [
    id,
    type,
    name,
    profileName,
    profileFullName,
    e164,
    serviceId,
    active_at,
  ] = rows[0];

  return {
    id,
    type,
    name: name || null,
    profileName: profileName || null,
    profileFullName: profileFullName || null,
    e164: e164 || null,
    serviceId: serviceId || null,
    active_at: active_at ? parseInt(active_at, 10) : null,
  };
}

/**
 * Fetch outgoing messages from the Note to Self conversation since a given timestamp.
 * Only includes messages with type='outgoing' (messages sent by the user to themselves).
 * Results ordered by sent_at ASC for incremental processing.
 *
 * NOTE: Full extraction implementation is in Phase 2.
 * This is the query skeleton — actual raw note saving happens in reader Phase 2.
 */
export function fetchNotesSince(
  conversationId: string,
  sinceMs: number,
  dbPath = DEFAULT_DB_PATH,
  key?: string
): SignalMessage[] {
  const sql = `SELECT id, conversationId, sent_at, received_at, type, body, hasAttachments, hasFileAttachments, hasVisualMediaAttachments, sourceServiceId
    FROM messages
    WHERE conversationId='${conversationId}'
      AND type='outgoing'
      AND sent_at > ${sinceMs}
    ORDER BY sent_at ASC;`;

  const output = querySqlcipher(sql, dbPath, key);
  const rows = parseRows(output);

  return rows
    .filter((r) => r.length >= 10)
    .map((r) => ({
      id: r[0],
      conversationId: r[1],
      sent_at: parseInt(r[2], 10),
      received_at: parseInt(r[3], 10),
      type: r[4],
      body: r[5] || null,
      hasAttachments: parseInt(r[6], 10),
      hasFileAttachments: parseInt(r[7], 10),
      hasVisualMediaAttachments: parseInt(r[8], 10),
      sourceServiceId: r[9] || null,
    }));
}

/**
 * Fetch attachment metadata for a given message from the `message_attachments` table.
 */
export function fetchAttachments(
  messageId: string,
  dbPath = DEFAULT_DB_PATH,
  key?: string
): AttachmentMeta[] {
  const sql = `SELECT messageId, contentType, path, fileName, size, width, height, duration, attachmentType
    FROM message_attachments
    WHERE messageId='${messageId}';`;

  const output = querySqlcipher(sql, dbPath, key);
  const rows = parseRows(output);

  return rows
    .filter((r) => r.length >= 9)
    .map((r) => ({
      messageId: r[0],
      contentType: r[1],
      path: r[2] || null,
      fileName: r[3] || null,
      size: parseInt(r[4], 10),
      width: r[5] ? parseInt(r[5], 10) : null,
      height: r[6] ? parseInt(r[6], 10) : null,
      duration: r[7] ? parseFloat(r[7]) : null,
      attachmentType: r[8],
    }));
}

/**
 * Resolve an attachment's filesystem path.
 * Signal stores attachments at: ~/.config/Signal/attachments.noindex/<path>
 */
export function resolveAttachmentPath(
  relativePath: string,
  attachmentsDir = DEFAULT_ATTACHMENTS_DIR
): string {
  return join(attachmentsDir, relativePath);
}

/**
 * Convenience: fetch a NoteToSelfMessage with its attachments for a given message row.
 */
export function buildNoteToSelfMessage(
  msg: SignalMessage,
  dbPath = DEFAULT_DB_PATH,
  key?: string
): NoteToSelfMessage {
  const attachments =
    msg.hasAttachments > 0
      ? fetchAttachments(msg.id, dbPath, key)
      : [];

  return {
    id: msg.id,
    conversationId: msg.conversationId,
    sentAt: msg.sent_at,
    body: msg.body,
    attachments,
  };
}

// ---------------------------------------------------------------------------
// Phase 2: State management and raw note file saving
// ---------------------------------------------------------------------------

const SIGNAL_BASE_DIR = join(homedir(), "Documents/ai-usage/signal");
const SIGNAL_RAW_DIR = join(SIGNAL_BASE_DIR, "raw");
const SIGNAL_ATTACHMENTS_DIR = join(SIGNAL_BASE_DIR, "attachments");
const STATE_FILE_PATH = join(SIGNAL_BASE_DIR, "state.json");

/** Ensure the signal/ folder structure exists (signal/raw/, signal/attachments/). */
export function ensureSignalFolderStructure(): void {
  for (const dir of [SIGNAL_RAW_DIR, SIGNAL_ATTACHMENTS_DIR]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

/**
 * Copy attachments from Signal's storage to ~/Documents/ai-usage/signal/attachments/.
 * Returns array of destination absolute paths for successfully copied files.
 * Logs a warning for any attachment that cannot be found or copied.
 *
 * Destination filename: YYYY-MM-DD-HH-MM-<originalBasename>
 * Preserves the original file extension.
 */
export function copyAttachments(
  note: NoteToSelfMessage,
  attachmentsDir = DEFAULT_ATTACHMENTS_DIR
): string[] {
  if (note.attachments.length === 0) return [];

  ensureSignalFolderStructure();
  const destPaths: string[] = [];

  for (const att of note.attachments) {
    if (!att.path) continue;

    const srcPath = join(attachmentsDir, att.path);
    if (!existsSync(srcPath)) {
      console.warn(`Warning: attachment source not found: ${srcPath}`);
      continue;
    }

    // Derive destination filename: prefix with timestamp to ensure uniqueness
    const originalName = att.fileName ?? basename(att.path);
    const prefix = formatTimestampForFile(note.sentAt);
    const destName = `${prefix}-${originalName}`;
    const destPath = join(SIGNAL_ATTACHMENTS_DIR, destName);

    try {
      copyFileSync(srcPath, destPath);
      destPaths.push(destPath);
    } catch (err) {
      console.warn(
        `Warning: failed to copy attachment ${srcPath}: ${(err as Error).message}`
      );
    }
  }

  return destPaths;
}

/**
 * Read the collector state from state.json.
 * Returns a default state if the file doesn't exist yet.
 */
export function readCollectorState(): SignalCollectorState {
  if (!existsSync(STATE_FILE_PATH)) {
    return {
      lastProcessedAt: 0,
      lastRunAt: null,
      totalProcessed: 0,
    };
  }
  try {
    const raw = readFileSync(STATE_FILE_PATH, "utf-8");
    return JSON.parse(raw) as SignalCollectorState;
  } catch {
    return {
      lastProcessedAt: 0,
      lastRunAt: null,
      totalProcessed: 0,
    };
  }
}

/**
 * Write the collector state to state.json atomically.
 */
export function writeCollectorState(state: SignalCollectorState): void {
  ensureSignalFolderStructure();
  writeFileSync(STATE_FILE_PATH, JSON.stringify(state, null, 2), "utf-8");
}

/**
 * Format a Unix timestamp (ms) as a date string for filenames.
 * Format: YYYY-MM-DD-HH-MM (24-hour, no leading zeros on components)
 */
function formatTimestampForFile(timestampMs: number): string {
  const d = new Date(timestampMs);
  const yyyy = d.getFullYear();
  const mm = d.getMonth() + 1; // 1-indexed
  const dd = d.getDate();
  const HH = d.getHours();
  const MM = d.getMinutes();
  return `${yyyy}-${mm}-${dd}-${HH}-${MM}`;
}

/**
 * Generate a short hash from a message ID + timestamp for unique filenames.
 * Uses SHA256 truncated to 8 hex chars.
 */
function generateMessageHash(id: string, timestampMs: number): string {
  const input = `${id}:${timestampMs}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 8);
}

/**
 * Save a NoteToSelfMessage as a raw note file.
 * Filename: YYYY-MM-DD-HH-MM-<hash>.md
 * Format: Markdown with frontmatter containing metadata.
 *
 * @param copiedAttachmentPaths - absolute paths of attachments already copied to signal/attachments/
 */
export function saveRawNote(note: NoteToSelfMessage, copiedAttachmentPaths: string[] = []): string {
  ensureSignalFolderStructure();

  const timestampStr = formatTimestampForFile(note.sentAt);
  const hash = generateMessageHash(note.id, note.sentAt);
  const filename = `${timestampStr}-${hash}.md`;
  const filePath = join(SIGNAL_RAW_DIR, filename);

  // Build frontmatter
  const attachmentPaths = note.attachments
    .map((a) => a.path)
    .filter((p): p is string => p !== null);

  const frontmatter = [
    "---",
    `id: ${note.id}`,
    `conversationId: ${note.conversationId}`,
    `sentAt: ${note.sentAt}`,
    `sentAtISO: ${new Date(note.sentAt).toISOString()}`,
    `hasAttachments: ${note.attachments.length > 0}`,
    attachmentPaths.length > 0 ? `attachments:` : null,
    ...attachmentPaths.map((p) => `  - ${p}`),
    copiedAttachmentPaths.length > 0
      ? `attachmentsCopied: ${JSON.stringify(copiedAttachmentPaths)}`
      : null,
    "---",
    "",
  ]
    .filter((l): l is string => l !== null)
    .join("\n");

  const body = note.body ?? "";
  const content = frontmatter + body + "\n";

  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

/**
 * Extract Note to Self messages since last run and save as raw notes.
 * Returns the number of new messages processed and their file paths.
 */
export function extractNotesSinceLastRun(
  conversationId: string,
  dbPath = DEFAULT_DB_PATH,
  key?: string
): { count: number; files: string[]; lastTimestamp: number } {
  const state = readCollectorState();
  const sinceMs = state.lastProcessedAt;

  const messages = fetchNotesSince(conversationId, sinceMs, dbPath, key);

  ensureSignalFolderStructure();

  if (messages.length === 0) {
    // Still update lastRunAt even when no new messages
    const newState: SignalCollectorState = {
      ...state,
      lastRunAt: new Date().toISOString(),
    };
    writeCollectorState(newState);
    return { count: 0, files: [], lastTimestamp: sinceMs };
  }

  const files: string[] = [];
  let lastTimestamp = sinceMs;

  for (const msg of messages) {
    const noteMsg = buildNoteToSelfMessage(msg, dbPath, key);
    const copiedPaths = copyAttachments(noteMsg);
    const filePath = saveRawNote(noteMsg, copiedPaths);
    files.push(filePath);
    lastTimestamp = Math.max(lastTimestamp, msg.sent_at);
  }

  // Update state
  const newState: SignalCollectorState = {
    lastProcessedAt: lastTimestamp,
    lastRunAt: new Date().toISOString(),
    totalProcessed: state.totalProcessed + messages.length,
  };
  writeCollectorState(newState);

  return { count: messages.length, files, lastTimestamp };
}
