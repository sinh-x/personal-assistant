/**
 * Markdown frontmatter parser and feedback annotation writer.
 *
 * Ported from Dart: avodah/mcp/lib/services/markdown_parser.dart
 *
 * Two metadata formats:
 * 1. Inline metadata — `> **Key:** Value` lines in the document body
 * 2. YAML frontmatter — `---` delimited block at the top of the file
 */

import { basename } from "node:path";

// --- Types ---

export interface HumanFeedback {
  action: string;
  by?: string;
  at?: string;
  note?: string;
  chips: string[];
  what_is_wrong?: string;
  what_to_fix?: string;
  priority?: string;
  defer_reason?: string;
  requeue_after?: string;
}

export interface MarkdownMetadata {
  title: string;
  date?: string;
  from?: string;
  to?: string;
  deployment?: string;
  type?: string;
  status?: string;
  priority?: string;
  human_feedback?: HumanFeedback;
}

export type FeedbackAnnotation =
  | { kind: "approve"; note?: string; chips?: string[] }
  | {
      kind: "reject";
      what_is_wrong: string;
      what_to_fix: string;
      priority?: string;
      chips?: string[];
    }
  | { kind: "pending-reject" }
  | { kind: "defer"; reason?: string; requeue_after?: string; chips?: string[] }
  | { kind: "save-for-later" }
  | { kind: "acknowledge"; note?: string };

// --- Patterns ---

const METADATA_PATTERN = /^>\s*\*\*(.+?):\*\*\s*(.+)$/;
const TITLE_PATTERN = /^#\s+(.+)$/;

// --- Frontmatter helpers ---

function extractFrontmatter(content: string): string | null {
  if (!content.startsWith("---\n")) return null;
  const end = content.indexOf("\n---\n", 4);
  if (end === -1) return null;
  return content.substring(4, end);
}

function stripFrontmatter(content: string): string {
  if (!content.startsWith("---\n")) return content;
  const end = content.indexOf("\n---\n", 4);
  if (end === -1) return content;
  return content.substring(end + 5);
}

function unquoteYamlValue(value: string): string {
  if (value.length >= 2) {
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      return value.substring(1, value.length - 1);
    }
  }
  return value;
}

function parseYamlList(value: string): string[] {
  if (!value.startsWith("[") || !value.endsWith("]")) return [];
  const inner = value.substring(1, value.length - 1);
  return inner
    .split(",")
    .map((e) => unquoteYamlValue(e.trim()))
    .filter((e) => e.length > 0);
}

// --- Parsing ---

function parseFrontmatterFeedback(content: string): HumanFeedback | undefined {
  const frontmatter = extractFrontmatter(content);
  if (!frontmatter) return undefined;

  const lines = frontmatter.split("\n");
  let feedbackStart: number | undefined;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimEnd() === "human_feedback:") {
      feedbackStart = i + 1;
      break;
    }
  }
  if (feedbackStart === undefined) return undefined;

  const feedbackMap: Record<string, string> = {};
  for (let i = feedbackStart; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 0 && !line.startsWith(" ") && !line.startsWith("\t")) {
      break;
    }
    const trimmed = line.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx <= 0) continue;
    const key = trimmed.substring(0, colonIdx).trim();
    const rawValue = trimmed.substring(colonIdx + 1).trim();
    feedbackMap[key] = unquoteYamlValue(rawValue);
  }

  const action = feedbackMap["action"];
  if (!action) return undefined;

  const chipsRaw = feedbackMap["chips"];
  const chips = chipsRaw ? parseYamlList(chipsRaw) : [];

  const feedback: HumanFeedback = { action, chips };
  if (feedbackMap["by"]) feedback.by = feedbackMap["by"];
  if (feedbackMap["at"]) feedback.at = feedbackMap["at"];
  if (feedbackMap["note"]) feedback.note = feedbackMap["note"];
  if (feedbackMap["what_is_wrong"])
    feedback.what_is_wrong = feedbackMap["what_is_wrong"];
  if (feedbackMap["what_to_fix"])
    feedback.what_to_fix = feedbackMap["what_to_fix"];
  if (feedbackMap["priority"]) feedback.priority = feedbackMap["priority"];
  if (feedbackMap["defer_reason"])
    feedback.defer_reason = feedbackMap["defer_reason"];
  if (feedbackMap["requeue_after"])
    feedback.requeue_after = feedbackMap["requeue_after"];
  return feedback;
}

export function parseMarkdownMetadata(
  content: string,
  filename?: string
): MarkdownMetadata {
  let title: string | undefined;
  let date: string | undefined;
  let from: string | undefined;
  let to: string | undefined;
  let deployment: string | undefined;
  let type: string | undefined;
  let status: string | undefined;
  let priority: string | undefined;

  const humanFeedback = parseFrontmatterFeedback(content);
  const body = stripFrontmatter(content);

  for (const line of body.split("\n")) {
    const trimmed = line.trim();

    if (!title) {
      const titleMatch = TITLE_PATTERN.exec(trimmed);
      if (titleMatch) {
        title = titleMatch[1].trim();
        continue;
      }
    }

    const metaMatch = METADATA_PATTERN.exec(trimmed);
    if (metaMatch) {
      const key = metaMatch[1].trim().toLowerCase();
      const value = metaMatch[2].trim();
      switch (key) {
        case "date":
          date = value;
          break;
        case "from":
          from = value;
          break;
        case "to":
          to = value;
          break;
        case "deployment":
          deployment = value;
          break;
        case "type":
          type = value;
          break;
        case "status":
          status = value;
          break;
        case "priority":
          priority = value;
          break;
      }
    }
  }

  if (!title) {
    title = filename ? basename(filename).replace(/\.md$/, "") : "Untitled";
  }

  const meta: MarkdownMetadata = { title };
  if (date) meta.date = date;
  if (from) meta.from = from;
  if (to) meta.to = to;
  if (deployment) meta.deployment = deployment;
  if (type) meta.type = type;
  if (status) meta.status = status;
  if (priority) meta.priority = priority;
  if (humanFeedback) meta.human_feedback = humanFeedback;
  return meta;
}

function normalizeDocumentType(raw: string): string {
  const lower = raw.toLowerCase().trim();
  if (lower === "work-report" || lower === "work report") return "work-report";
  if (lower.startsWith("review")) return "review-request";
  if (lower.startsWith("plan")) return "plan-draft";
  if (lower.startsWith("fyi") || lower === "notification") return "fyi";
  if (lower.startsWith("decision")) return "decision-needed";
  return "work-report";
}

export function detectDocumentType(content: string, filename: string): string {
  const body = stripFrontmatter(content);
  for (const line of body.split("\n")) {
    if (line.startsWith("> **Type:**")) {
      const value = line.replace("> **Type:**", "").trim();
      return normalizeDocumentType(value);
    }
    if (
      line.length > 0 &&
      !line.startsWith("#") &&
      !line.startsWith(">") &&
      line.trim().length > 0
    ) {
      break;
    }
  }

  const base = basename(filename);
  const withoutDate = base.replace(/^\d{4}-\d{2}-\d{2}-/, "");
  if (withoutDate.startsWith("review-")) return "review-request";
  if (withoutDate.includes("plan-draft")) return "plan-draft";
  return "work-report";
}

// --- Annotation writing ---

function quoteYamlString(value: string): string {
  if (
    value.includes(": ") ||
    value.includes("#") ||
    value.includes('"') ||
    value.includes("'")
  ) {
    const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `"${escaped}"`;
  }
  return value;
}

function buildFeedbackYaml(opts: {
  action: string;
  by: string;
  at: string;
  note?: string;
  chips?: string[];
  what_is_wrong?: string;
  what_to_fix?: string;
  priority?: string;
  defer_reason?: string;
  requeue_after?: string;
}): string {
  const lines: string[] = [
    "human_feedback:",
    `  action: ${opts.action}`,
    `  by: ${opts.by}`,
    `  at: ${opts.at}`,
  ];
  if (opts.note) lines.push(`  note: ${quoteYamlString(opts.note)}`);
  if (opts.chips && opts.chips.length > 0) {
    const chipsStr = opts.chips
      .map((c) => `"${c.replace(/"/g, '\\"')}"`)
      .join(", ");
    lines.push(`  chips: [${chipsStr}]`);
  }
  if (opts.what_is_wrong)
    lines.push(`  what_is_wrong: ${quoteYamlString(opts.what_is_wrong)}`);
  if (opts.what_to_fix)
    lines.push(`  what_to_fix: ${quoteYamlString(opts.what_to_fix)}`);
  if (opts.priority) lines.push(`  priority: ${opts.priority}`);
  if (opts.defer_reason)
    lines.push(`  defer_reason: ${quoteYamlString(opts.defer_reason)}`);
  if (opts.requeue_after)
    lines.push(`  requeue_after: "${opts.requeue_after}"`);
  return lines.join("\n");
}

function buildHumanReviewSection(opts: {
  action: string;
  at: string;
  note?: string;
  chips?: string[];
  what_is_wrong?: string;
  what_to_fix?: string;
  priority?: string;
  defer_reason?: string;
  requeue_after?: string;
}): string {
  const displayAt = opts.at.length > 16 ? opts.at.substring(0, 16) : opts.at;
  const lines: string[] = [
    "## Human Review",
    "",
    `> **Action:** ${opts.action}`,
    `> **By:** Sinh`,
    `> **At:** ${displayAt}`,
  ];
  if (opts.note) lines.push(`> **Note:** ${opts.note}`);
  if (opts.chips && opts.chips.length > 0)
    lines.push(`> **Chips:** ${opts.chips.join(", ")}`);
  if (opts.what_is_wrong)
    lines.push(`> **What's wrong:** ${opts.what_is_wrong}`);
  if (opts.what_to_fix) lines.push(`> **What to fix:** ${opts.what_to_fix}`);
  if (opts.priority)
    lines.push(
      `> **Priority:** ${opts.priority[0].toUpperCase()}${opts.priority.slice(1)}`
    );
  if (opts.defer_reason) lines.push(`> **Reason:** ${opts.defer_reason}`);
  if (opts.requeue_after)
    lines.push(`> **Re-queue after:** ${opts.requeue_after}`);
  return lines.join("\n");
}

function removeFrontmatterKey(yaml: string, key: string): string {
  const lines = yaml.split("\n");
  const result: string[] = [];
  let inKey = false;
  for (const line of lines) {
    if (
      line.trimEnd() === `${key}:` ||
      line.startsWith(`${key}: `) ||
      line.startsWith(`${key}:`)
    ) {
      inKey = true;
      continue;
    }
    if (inKey) {
      if (line.startsWith(" ") || line.startsWith("\t") || line === "") {
        continue;
      }
      inKey = false;
    }
    result.push(line);
  }
  while (result.length > 0 && result[result.length - 1] === "") {
    result.pop();
  }
  return result.join("\n");
}

function mergeYamlFrontmatter(content: string, yamlBlock: string): string {
  if (content.startsWith("---\n")) {
    const endIdx = content.indexOf("\n---\n", 4);
    if (endIdx !== -1) {
      let existing = content.substring(4, endIdx);
      const afterFrontmatter = content.substring(endIdx + 5);
      existing = removeFrontmatterKey(existing, "human_feedback");
      if (existing.length > 0 && !existing.endsWith("\n")) {
        existing = existing + "\n";
      }
      const merged = existing + yamlBlock;
      return `---\n${merged}\n---\n${afterFrontmatter}`;
    }
  }
  return `---\n${yamlBlock}\n---\n${content}`;
}

function applyAnnotation(
  content: string,
  yamlBlock: string,
  humanReviewSection: string | null
): string {
  let result = mergeYamlFrontmatter(content, yamlBlock);
  if (humanReviewSection !== null) {
    if (!result.endsWith("\n")) result = result + "\n";
    if (!result.endsWith("\n\n")) result = result + "\n";
    result = result + humanReviewSection + "\n";
  }
  return result;
}

export function writeFeedbackAnnotation(
  content: string,
  annotation: FeedbackAnnotation
): string {
  const now = new Date().toISOString();
  const by = "Sinh";

  switch (annotation.kind) {
    case "approve": {
      const { note, chips = [] } = annotation;
      const hasContent = (note && note.length > 0) || chips.length > 0;
      if (!hasContent) return content;
      const yaml = buildFeedbackYaml({
        action: "approved",
        by,
        at: now,
        note,
        chips,
      });
      const section = buildHumanReviewSection({
        action: "approved",
        at: now,
        note,
        chips,
      });
      return applyAnnotation(content, yaml, section);
    }

    case "reject": {
      const { what_is_wrong, what_to_fix, priority = "medium", chips = [] } =
        annotation;
      const yaml = buildFeedbackYaml({
        action: "rejected",
        by,
        at: now,
        chips,
        what_is_wrong,
        what_to_fix,
        priority,
      });
      const section = buildHumanReviewSection({
        action: "rejected",
        at: now,
        chips,
        what_is_wrong,
        what_to_fix,
        priority,
      });
      return applyAnnotation(content, yaml, section);
    }

    case "pending-reject": {
      const yaml = buildFeedbackYaml({
        action: "pending-reject-feedback",
        by,
        at: now,
      });
      return applyAnnotation(content, yaml, null);
    }

    case "defer": {
      const { reason, requeue_after, chips = [] } = annotation;
      const hasContent =
        (reason && reason.length > 0) || requeue_after != null || chips.length > 0;
      if (!hasContent) return content;
      const yaml = buildFeedbackYaml({
        action: "deferred",
        by,
        at: now,
        chips,
        defer_reason: reason,
        requeue_after,
      });
      const section = buildHumanReviewSection({
        action: "deferred",
        at: now,
        chips,
        defer_reason: reason,
        requeue_after,
      });
      return applyAnnotation(content, yaml, section);
    }

    case "save-for-later": {
      const yaml = buildFeedbackYaml({ action: "saved-for-later", by, at: now });
      return applyAnnotation(content, yaml, null);
    }

    case "acknowledge": {
      const { note } = annotation;
      if (!note || note.length === 0) return content;
      const yaml = buildFeedbackYaml({
        action: "acknowledged",
        by,
        at: now,
        note,
      });
      return applyAnnotation(content, yaml, null);
    }
  }
}
