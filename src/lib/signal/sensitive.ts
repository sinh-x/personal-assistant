/**
 * Sensitive content detection for Signal note routing.
 *
 * Detects seed phrases, SSH keys, API tokens, and Signal device links.
 * All detection is regex-based — no external API calls.
 */

/** 12+ space-separated lowercase words (BIP39 seed phrase heuristic). */
const SEED_PHRASE_RE = /^[a-z]+(\s+[a-z]+){11,}$/;

/** SSH public key prefixes. */
const SSH_KEY_RE = /^ssh-(ed25519|rsa|ecdsa)\s/;

/** Telegram-style bot tokens: digits:alphanumeric (5+ digits, 35+ chars after colon). */
const API_TOKEN_RE = /\d{5,}:[A-Za-z0-9_-]{35,}/;

/** Signal device-link URLs. */
const SGNL_URL_RE = /^sgnl:\/\//;

/**
 * Check whether message body contains sensitive content.
 * Returns true if any sensitive pattern matches.
 */
export function isSensitive(body: string): boolean {
  const trimmed = body.trim();
  if (!trimmed) return false;

  if (SEED_PHRASE_RE.test(trimmed)) return true;
  if (SSH_KEY_RE.test(trimmed)) return true;
  if (API_TOKEN_RE.test(trimmed)) return true;
  if (SGNL_URL_RE.test(trimmed)) return true;

  return false;
}
