/**
 * Rule-based message router for Signal Note to Self pipeline.
 *
 * Replaces the MiniMax AI classifier with deterministic routing:
 * 1. Parse prefix tag (#idea, #task, #learn, #yt, #buy, #link, #secret)
 * 2. Auto-detect URL type (YouTube, Facebook, article domains)
 * 3. Auto-detect sensitive content (seed phrases, SSH keys, tokens)
 * 4. Fallback: untagged text → daily log, attachment-only → log entry
 */

import { readFileSync } from "node:fs";
import type { PrefixTag, RouteDestination, RoutingResult } from "./types.js";
import { isSensitive } from "./sensitive.js";

// ---------------------------------------------------------------------------
// Tag parsing
// ---------------------------------------------------------------------------

const VALID_TAGS: Set<string> = new Set([
  "idea", "task", "learn", "yt", "buy", "link", "secret",
]);

/**
 * Parse a prefix tag from the first word of a message body.
 * Returns the tag and remaining content, or null if no tag found.
 */
export function parseTag(body: string): { tag: PrefixTag; content: string } | null {
  const trimmed = body.trim();
  if (!trimmed.startsWith("#")) return null;

  const spaceIdx = trimmed.indexOf(" ");
  const tagWord = spaceIdx > 0 ? trimmed.slice(1, spaceIdx) : trimmed.slice(1);
  const normalized = tagWord.toLowerCase();

  if (!VALID_TAGS.has(normalized)) return null;

  const content = spaceIdx > 0 ? trimmed.slice(spaceIdx + 1).trim() : "";
  return { tag: normalized as PrefixTag, content };
}

// ---------------------------------------------------------------------------
// URL detection
// ---------------------------------------------------------------------------

const YOUTUBE_RE = /(?:youtube\.com\/|youtu\.be\/)/i;
const FACEBOOK_RE = /facebook\.com\/share\//i;

const ARTICLE_DOMAINS = [
  "howtogeek.com",
  "reddit.com",
  "github.com",
  "docs.google.com",
  "medium.com",
  "dev.to",
  "stackoverflow.com",
  "news.ycombinator.com",
];

const URL_RE = /https?:\/\/[^\s]+/i;

export type UrlType = "youtube" | "facebook" | "article" | "generic" | null;

/**
 * Detect URL type from message body.
 * Returns the URL type and the matched URL string.
 */
export function detectUrlType(body: string): { type: UrlType; url: string | null } {
  const match = body.match(URL_RE);
  if (!match) return { type: null, url: null };

  const url = match[0];

  if (YOUTUBE_RE.test(url)) return { type: "youtube", url };
  if (FACEBOOK_RE.test(url)) return { type: "facebook", url };

  for (const domain of ARTICLE_DOMAINS) {
    if (url.includes(domain)) return { type: "article", url };
  }

  return { type: "generic", url };
}

// ---------------------------------------------------------------------------
// Tag → destination mapping
// ---------------------------------------------------------------------------

const TAG_DESTINATION: Record<PrefixTag, RouteDestination> = {
  idea: "ticket-idea",
  task: "ticket-task",
  learn: "spike-queue",
  yt: "youtube-queue",
  buy: "ticket-buy",
  link: "bookmark",
  secret: "sensitive",
};

// ---------------------------------------------------------------------------
// Frontmatter parsing (shared with classifier.ts)
// ---------------------------------------------------------------------------

function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const lines = content.split("\n");
  const fm: Record<string, string> = {};
  let bodyLines: string[] = [];
  let inFm = false;
  let bodyStarted = false;

  for (const line of lines) {
    if (line.trim() === "---") {
      if (!inFm) { inFm = true; continue; }
      else { inFm = false; bodyStarted = true; continue; }
    }
    if (bodyStarted) {
      bodyLines.push(line);
    } else if (inFm) {
      const colonIdx = line.indexOf(":");
      if (colonIdx > 0) {
        fm[line.slice(0, colonIdx).trim()] = line.slice(colonIdx + 1).trim();
      }
    }
  }

  return { frontmatter: fm, body: bodyLines.join("\n").trim() };
}

// ---------------------------------------------------------------------------
// Main router
// ---------------------------------------------------------------------------

/**
 * Route a raw note file through the rule-based pipeline.
 *
 * Priority order:
 * 1. Prefix tag → route by tag
 * 2. Sensitive auto-detect → sensitive file
 * 3. URL auto-detect → youtube/facebook/article/bookmark
 * 4. Attachment-only (no text) → attachment-only log
 * 5. Untagged text → daily log
 */
export function routeMessage(rawFilePath: string): RoutingResult {
  const fileContent = readFileSync(rawFilePath, "utf-8");
  const { frontmatter, body } = parseFrontmatter(fileContent);

  // Extract attachment paths from frontmatter
  let attachmentPaths: string[] = [];
  const copiedRaw = frontmatter["attachmentsCopied"];
  if (copiedRaw) {
    try { attachmentPaths = JSON.parse(copiedRaw) as string[]; } catch { /* ignore */ }
  }

  const hasBody = body.length > 0;

  // Attachment-only: no text body
  if (!hasBody) {
    return {
      destination: "attachment-only",
      content: "",
      tag: null,
      detectedUrl: null,
      sensitiveDetected: false,
      attachmentOnly: true,
      attachmentPaths,
    };
  }

  // 1. Check prefix tag
  const tagResult = parseTag(body);
  if (tagResult) {
    const dest = TAG_DESTINATION[tagResult.tag];
    // #secret tag forces sensitive regardless
    return {
      destination: dest,
      content: tagResult.content,
      tag: tagResult.tag,
      detectedUrl: null,
      sensitiveDetected: tagResult.tag === "secret",
      attachmentOnly: false,
      attachmentPaths,
    };
  }

  // 2. Sensitive auto-detect (before URL detection — safety first)
  if (isSensitive(body)) {
    return {
      destination: "sensitive",
      content: body,
      tag: null,
      detectedUrl: null,
      sensitiveDetected: true,
      attachmentOnly: false,
      attachmentPaths,
    };
  }

  // 3. URL auto-detect
  const urlResult = detectUrlType(body);
  if (urlResult.type === "youtube") {
    return {
      destination: "youtube-queue",
      content: body,
      tag: null,
      detectedUrl: urlResult.url,
      sensitiveDetected: false,
      attachmentOnly: false,
      attachmentPaths,
    };
  }
  if (urlResult.type === "facebook") {
    return {
      destination: "bookmark",
      content: body,
      tag: null,
      detectedUrl: urlResult.url,
      sensitiveDetected: false,
      attachmentOnly: false,
      attachmentPaths,
    };
  }
  if (urlResult.type === "article") {
    return {
      destination: "spike-queue",
      content: body,
      tag: null,
      detectedUrl: urlResult.url,
      sensitiveDetected: false,
      attachmentOnly: false,
      attachmentPaths,
    };
  }
  if (urlResult.type === "generic") {
    return {
      destination: "bookmark",
      content: body,
      tag: null,
      detectedUrl: urlResult.url,
      sensitiveDetected: false,
      attachmentOnly: false,
      attachmentPaths,
    };
  }

  // 4. Untagged plain text → daily log
  return {
    destination: "daily-log",
    content: body,
    tag: null,
    detectedUrl: null,
    sensitiveDetected: false,
    attachmentOnly: false,
    attachmentPaths,
  };
}
