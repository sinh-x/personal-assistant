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
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  SignalConversation,
  SignalAccountIdentity,
  NoteToSelfMessage,
  AttachmentMeta,
  SignalMessage,
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
