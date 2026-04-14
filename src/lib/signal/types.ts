/**
 * Signal Desktop message types for Note to Self extraction.
 *
 * Schema derived from Signal Desktop SQLCipher DB exploration (2026-04-13).
 * DB path: ~/.config/Signal/sql/db.sqlite
 * Key source: ~/.config/Signal/config.json (64-char hex key)
 */

/** A row from the `conversations` table. */
export interface SignalConversation {
  id: string;
  /** 'private' | 'group' */
  type: string;
  name: string | null;
  profileName: string | null;
  profileFullName: string | null;
  /** E.164 phone number, e.g. '+84984320253' */
  e164: string | null;
  /** ACI UUID or PNI UUID */
  serviceId: string | null;
  active_at: number | null;
}

/** A row from the `messages` table. */
export interface SignalMessage {
  id: string;
  conversationId: string;
  /** Unix timestamp in milliseconds */
  sent_at: number;
  /** Unix timestamp in milliseconds (receive time) */
  received_at: number;
  /** 'outgoing' | 'incoming' | 'call-history' | 'profile-change' | etc. */
  type: string;
  body: string | null;
  hasAttachments: number;
  hasFileAttachments: number;
  hasVisualMediaAttachments: number;
  sourceServiceId: string | null;
}

/** A row from the `message_attachments` table. */
export interface AttachmentMeta {
  messageId: string;
  /** MIME type, e.g. 'image/jpeg', 'audio/mp4', 'application/pdf' */
  contentType: string;
  /** Relative path under ~/.config/Signal/attachments.noindex/ */
  path: string | null;
  fileName: string | null;
  size: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  /** 'attachment' | 'preview' | etc. */
  attachmentType: string;
}

/** Identity of the local Signal account, read from the `items` table. */
export interface SignalAccountIdentity {
  /** E.164 phone number, e.g. '+84984320253' (from items where id='number_id') */
  e164: string;
  /** ACI UUID, e.g. '7b4bdade-e8bd-4add-9aa7-8aeb0af3e1dc' (from items where id='uuid_id') */
  uuid: string;
}

/** A Note to Self message with its attachments. */
export interface NoteToSelfMessage {
  id: string;
  conversationId: string;
  sentAt: number;
  body: string | null;
  attachments: AttachmentMeta[];
}

/** State tracking file structure for incremental collection. */
export interface SignalCollectorState {
  /** Unix timestamp (ms) of the last processed message. 0 if never run. */
  lastProcessedAt: number;
  /** ISO datetime string of the last run. */
  lastRunAt: string | null;
  /** Total messages processed across all runs. */
  totalProcessed: number;
}

// ---------------------------------------------------------------------------
// Routing types (classification rework — rule-based, no AI)
// ---------------------------------------------------------------------------

/** Prefix tags that Sinh can use on Signal messages. */
export type PrefixTag = "idea" | "task" | "learn" | "yt" | "buy" | "link" | "secret";

/** Destination for a routed message. */
export type RouteDestination =
  | "ticket-idea"
  | "ticket-task"
  | "ticket-buy"
  | "youtube-queue"
  | "spike-queue"
  | "bookmark"
  | "sensitive"
  | "daily-log"
  | "attachment-only";

/** Result of routing a single raw note. */
export interface RoutingResult {
  /** Where the message should go. */
  destination: RouteDestination;
  /** The content after tag stripping (or original body). */
  content: string;
  /** Detected prefix tag, if any. */
  tag: PrefixTag | null;
  /** Detected URL, if any. */
  detectedUrl: string | null;
  /** Whether sensitive content was auto-detected. */
  sensitiveDetected: boolean;
  /** Has attachments but no text body. */
  attachmentOnly: boolean;
  /** Copied attachment paths (from frontmatter). */
  attachmentPaths: string[];
}
