#!/usr/bin/env node
/**
 * Test runner for inline section insert logic.
 * Run directly: node scripts/test-section-insert.js
 */

import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";

const SANDBOX_ROOT = "/home/sinh/Documents/ai-usage";

// ─── Inline implementations (same as documents.ts) ────────────────────────────

function computeInsertPosition(location, lineCount) {
  // Mirrors the documents.ts implementation:
  // location <= 0 → prepend (position 0)
  // location > lineCount → append (position = lineCount)
  // 1 <= location <= lineCount → insert BEFORE line at that index (1-based)
  if (location <= 0) return 0;
  if (location > lineCount) return lineCount;
  return location - 1;
}

function buildSection(title, content) {
  return `### ${title}\n\n${content}\n`;
}

// ─── Test framework ───────────────────────────────────────────────────────────

function expect(actual) {
  return {
    toBe: (expected) => {
      if (actual !== expected) throw new Error(`FAIL: Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      console.log(`  PASS: toBe ${JSON.stringify(expected)}`);
    },
    toContain: (expected) => {
      if (!actual.includes(expected)) throw new Error(`FAIL: Expected ${JSON.stringify(actual)} to contain ${JSON.stringify(expected)}`);
      console.log(`  PASS: toContain ${JSON.stringify(expected)}`);
    },
    toBeDefined: () => {
      if (actual === undefined) throw new Error("FAIL: Expected defined");
      console.log("  PASS: toBeDefined");
    },
    toBeGreaterThan: (expected) => {
      if (actual <= expected) throw new Error(`FAIL: Expected ${actual} > ${expected}`);
      console.log(`  PASS: toBeGreaterThan ${expected}`);
    },
    toBeLessThan: (expected) => {
      if (actual >= expected) throw new Error(`FAIL: Expected ${actual} < ${expected}`);
      console.log(`  PASS: toBeLessThan ${expected}`);
    },
    toThrow: () => {
      let threw = false;
      try { actual(); } catch { threw = true; }
      if (!threw) throw new Error("FAIL: Expected function to throw");
      console.log("  PASS: toThrow");
    }
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────────

async function doInsert(opts) {
  const { fileContent, title, content, location, fileId = "test.md" } = opts;
  const td = mkdtempSync(join(tmpdir(), "pa-section-test-"));
  const filePath = join(td, fileId);
  await writeFile(filePath, fileContent, "utf8");
  const newSection = buildSection(title, content);

    let updatedContent;
    if (fileContent === "") {
        // Empty file: newSection becomes the entire file
        updatedContent = newSection;
    } else {
        const lines = fileContent.split("\n");
        const lineCount = lines.length;
        const insertPos = computeInsertPosition(location, lineCount);
        lines.splice(insertPos, 0, newSection);
        updatedContent = lines.join("\n");
    }

    await writeFile(filePath, updatedContent, "utf8");
    await unlink(filePath).catch(() => {});
    return { path: `${td}/${fileId}`, content: updatedContent, metadata: { size: updatedContent.length } };
}

async function run() {
  let passed = 0, failed = 0;
  const log = (msg) => console.log(msg);

  try {
    log("\n=== computeInsertPosition ===");
    expect(computeInsertPosition(1, 5)).toBe(0);
    expect(computeInsertPosition(3, 5)).toBe(2);
    expect(computeInsertPosition(10, 5)).toBe(5);
    // documents.ts: Math.min(location - 1, lineCount)
    // location=5, lineCount=5 → Math.min(4, 5) = 4 (insert BEFORE line 5, not append)
    expect(computeInsertPosition(5, 5)).toBe(4);
    expect(computeInsertPosition(0, 5)).toBe(0);
    expect(computeInsertPosition(-1, 5)).toBe(0);
    expect(computeInsertPosition(1, 1)).toBe(0);
    expect(computeInsertPosition(1, 0)).toBe(0);
    passed += 8;
  } catch(e) { failed++; console.error(e.message); }

  try {
    log("\n=== buildSection ===");
    expect(buildSection("Open question", "Please clarify")).toBe("### Open question\n\nPlease clarify\n");
    expect(buildSection("Title", "")).toBe("### Title\n\n\n");
    passed += 2;
  } catch(e) { failed++; console.error(e.message); }

  try {
    log("\n=== AC1: location=1 inserts BEFORE first line ===");
    const r = await doInsert({ fileContent: "# Header\n\nSome paragraph here", title: "Comment", content: "This is a comment", location: 1 });
    expect(r.content.indexOf("### Comment")).toBe(0);
    expect(r.content).toContain("Some paragraph here");
    passed += 2;
  } catch(e) { failed++; console.error(e.message); }

  try {
    log("\n=== AC2: location > lineCount appends to end ===");
    const r = await doInsert({ fileContent: "# Header\n\nFirst paragraph", title: "New Section", content: "Added at end", location: 100 });
    expect(r.content).toContain("### New Section\n\nAdded at end\n");
    expect(r.content.indexOf("### New Section")).toBeGreaterThan(r.content.indexOf("First paragraph"));
    passed += 2;
  } catch(e) { failed++; console.error(e.message); }

  try {
    log("\n=== AC3: location=0 prepends as first content ===");
    const r = await doInsert({ fileContent: "# Header\n\nFirst paragraph", title: "Prefixed", content: "Prepended content", location: 0 });
    expect(r.content.indexOf("### Prefixed")).toBe(0);
    passed += 1;
  } catch(e) { failed++; console.error(e.message); }

  try {
    log("\n=== AC4: empty file gets section as entire file ===");
    const r = await doInsert({ fileContent: "", title: "First Section", content: "The only content", location: 1 });
    expect(r.content).toBe("### First Section\n\nThe only content\n");
    passed += 1;
  } catch(e) { failed++; console.error(e.message); }

  try {
    log("\n=== AC5: response shape has path, content, metadata ===");
    const r = await doInsert({ fileContent: "# Header", title: "Test", content: "Body", location: 1 });
    expect(r.path).toBeDefined();
    expect(r.content).toBeDefined();
    expect(r.metadata.size).toBeGreaterThan(0);
    passed += 3;
  } catch(e) { failed++; console.error(e.message); }

  try {
    log("\n=== mid-insert: location=2 on 3-line doc ===");
    const r = await doInsert({ fileContent: "Line 1\nLine 2\nLine 3", title: "Inserted", content: "Between 1 and 2", location: 2 });
    // Verify "Line 1" comes before "### Inserted"
    expect(r.content.indexOf("Line 1")).toBeLessThan(r.content.indexOf("### Inserted"));
    // Verify "### Inserted" comes before "Line 2"
    expect(r.content.indexOf("### Inserted")).toBeLessThan(r.content.indexOf("Line 2"));
    // Verify "Line 2" comes before "Line 3"
    expect(r.content.indexOf("Line 2")).toBeLessThan(r.content.indexOf("Line 3"));
    passed += 3;
  } catch(e) { failed++; console.error(e.message); }

  log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

run().catch(err => { console.error(err); process.exit(1); });
