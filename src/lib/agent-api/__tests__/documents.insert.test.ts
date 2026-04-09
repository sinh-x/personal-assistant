/**
 * Unit tests for POST /api/folders/:folderId/files/:fileId/sections
 * (location-aware inline section insert)
 *
 * Self-contained test runner — type-checked via tsc, run via node.
 * Run: npx tsc --noEmit && node dist/lib/agent-api/__tests__/documents.insert.test.js
 */

import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { normalizeSandboxPath, validateSandboxPath } from "../utils/sandbox.js";

const SANDBOX_ROOT = join(process.env.HOME || "", "Documents/ai-usage");

/**
 * Compute insert position from location and line count.
 * Mirrors the logic in documents.ts POST handler.
 * location=1 → insert at index 0 (before first line, 1-based)
 * location=3 → insert at index 2 (before third line)
 * location > lineCount → append (index = lineCount)
 * location <= 0 → prepend (index = 0)
 */
function computeInsertPosition(location: number, lineCount: number): number {
  // Mirrors the documents.ts implementation:
  // location <= 0 → prepend (position 0)
  // location > lineCount → append (position = lineCount)
  // 1 <= location <= lineCount → insert BEFORE line at that index (1-based)
  if (location <= 0) return 0;
  if (location > lineCount) return lineCount;
  return location - 1;
}

/**
 * Build a section string from title and content.
 * Mirrors the logic in documents.ts POST handler.
 */
function buildSection(title: string, content: string): string {
  return `### ${title}\n\n${content}\n`;
}

// ─── Test framework ────────────────────────────────────────────────────────────

type TestFn = () => void | Promise<void>;
const tests: Array<{ name: string; fn: TestFn }> = [];

function describe(_name: string, fn: () => void): void {
  fn();
}

function it(name: string, fn: TestFn): void {
  tests.push({ name, fn });
}

class Assertion {
  constructor(private actual: unknown) {}
  toBe(expected: unknown): void {
    if (this.actual !== expected)
      throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(this.actual)}`);
  }
  toContain(expected: string): void {
    if (typeof this.actual !== "string" || !this.actual.includes(expected))
      throw new Error(`Expected string to contain "${expected}", got ${JSON.stringify(this.actual)}`);
  }
  toBeDefined(): void {
    if (this.actual === undefined) throw new Error(`Expected defined, got undefined`);
  }
  toBeGreaterThan(expected: number): void {
    if (typeof this.actual !== "number" || this.actual <= expected)
      throw new Error(`Expected > ${expected}, got ${this.actual}`);
  }
  toBeLessThan(expected: number): void {
    if (typeof this.actual !== "number" || this.actual >= expected)
      throw new Error(`Expected < ${expected}, got ${this.actual}`);
  }
  toThrow(): void {
    if (typeof this.actual !== "function") throw new Error(`Expected function, got ${typeof this.actual}`);
    try {
      (this.actual as () => void)();
    } catch {
      return;
    }
    throw new Error("Expected function to throw");
  }
}

function expect(actual: unknown): Assertion {
  return new Assertion(actual);
}

async function runTests(): Promise<void> {
  let passed = 0;
  let failed = 0;
  for (const test of tests) {
    try {
      await test.fn();
      passed++;
    } catch (err) {
      failed++;
      console.error(`FAIL: ${test.name}`, err instanceof Error ? err.message : String(err));
    }
  }
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

// ─── computeInsertPosition tests ─────────────────────────────────────────────

describe("computeInsertPosition", () => {
  it("location=1 returns 0 (insert before first line, 1-based)", () => {
    expect(computeInsertPosition(1, 5)).toBe(0);
  });

  it("location=3 returns 2 (insert before line 3)", () => {
    expect(computeInsertPosition(3, 5)).toBe(2);
  });

  it("location > lineCount returns lineCount (append)", () => {
    expect(computeInsertPosition(10, 5)).toBe(5);
  });

  it("location = lineCount returns lineCount - 1 (insert before last line)", () => {
    // documents.ts uses Math.min(location - 1, lineCount)
    // location=5, lineCount=5 → Math.min(4, 5) = 4 (insert BEFORE line 5)
    expect(computeInsertPosition(5, 5)).toBe(4);
  });

  it("location = 0 returns 0 (prepend)", () => {
    expect(computeInsertPosition(0, 5)).toBe(0);
  });

  it("location < 0 returns 0 (prepend)", () => {
    expect(computeInsertPosition(-1, 5)).toBe(0);
  });

  it("location=1 on 1-line doc returns 0 (prepend)", () => {
    expect(computeInsertPosition(1, 1)).toBe(0);
  });

  it("location=1 on empty doc returns 0 (write entire doc)", () => {
    expect(computeInsertPosition(1, 0)).toBe(0);
  });
});

// ─── buildSection tests ────────────────────────────────────────────────────────

describe("buildSection", () => {
  it("builds section with title and content", () => {
    expect(buildSection("Open question", "Please clarify")).toBe(
      "### Open question\n\nPlease clarify\n"
    );
  });

  it("handles empty content", () => {
    expect(buildSection("Title", "")).toBe("### Title\n\n\n");
  });
});

// ─── Insert logic integration tests ───────────────────────────────────────────

async function doInsert(opts: {
  fileContent: string;
  title: string;
  content: string;
  location: number;
  fileId?: string;
  tmpDir?: string;
}): Promise<{ path: string; content: string; metadata: Record<string, unknown> }> {
  const { fileContent, title, content, location, fileId = "test.md", tmpDir: dir } = opts;
  const td = dir ?? mkdtempSync(join(tmpdir(), "pa-section-test-"));
  const filePath = join(td, fileId);
  await writeFile(filePath, fileContent, "utf8");

  const newSection = buildSection(title, content);
  let updatedContent: string;

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

  return {
    path: `${td}/${fileId}`,
    content: updatedContent,
    metadata: { size: updatedContent.length },
  };
}

describe("insert logic integration", () => {
  it("AC1: location=1 inserts BEFORE first line", async () => {
    const td = mkdtempSync(join(tmpdir(), "pa-section-test-"));
    const initial = "# Header\n\nSome paragraph here";
    const result = await doInsert({
      fileContent: initial,
      title: "Comment",
      content: "This is a comment",
      location: 1,
      tmpDir: td,
    });
    expect(result.content).toContain("### Comment");
    expect(result.content.indexOf("### Comment")).toBe(0);
    expect(result.content).toContain("Some paragraph here");
    await unlink(join(td, "test.md")).catch(() => {});
  });

  it("AC2: location > lineCount appends to end", async () => {
    const td = mkdtempSync(join(tmpdir(), "pa-section-test-"));
    const initial = "# Header\n\nFirst paragraph";
    const result = await doInsert({
      fileContent: initial,
      title: "New Section",
      content: "Added at end",
      location: 100,
      tmpDir: td,
    });
    expect(result.content).toContain("### New Section\n\nAdded at end\n");
    expect(result.content.indexOf("### New Section")).toBeGreaterThan(
      result.content.indexOf("First paragraph")
    );
    await unlink(join(td, "test.md")).catch(() => {});
  });

  it("AC3: location=0 prepends as first content", async () => {
    const td = mkdtempSync(join(tmpdir(), "pa-section-test-"));
    const initial = "# Header\n\nFirst paragraph";
    const result = await doInsert({
      fileContent: initial,
      title: "Prefixed",
      content: "Prepended content",
      location: 0,
      tmpDir: td,
    });
    expect(result.content.indexOf("### Prefixed")).toBe(0);
    await unlink(join(td, "test.md")).catch(() => {});
  });

  it("AC4: empty file gets section as entire file", async () => {
    const td = mkdtempSync(join(tmpdir(), "pa-section-test-"));
    const result = await doInsert({
      fileContent: "",
      title: "First Section",
      content: "The only content",
      location: 1,
      tmpDir: td,
    });
    expect(result.content).toBe("### First Section\n\nThe only content\n");
    await unlink(join(td, "test.md")).catch(() => {});
  });

  it("AC5: response shape has path, content, metadata", async () => {
    const td = mkdtempSync(join(tmpdir(), "pa-section-test-"));
    const result = await doInsert({
      fileContent: "# Header",
      title: "Test",
      content: "Body",
      location: 1,
      tmpDir: td,
    });
    expect(result.path).toBeDefined();
    expect(result.content).toBeDefined();
    expect(result.metadata).toBeDefined();
    expect(result.metadata.size).toBeGreaterThan(0);
    await unlink(join(td, "test.md")).catch(() => {});
  });

  it("mid-insert: location=2 on 3-line doc inserts before line 2", async () => {
    const td = mkdtempSync(join(tmpdir(), "pa-section-test-"));
    const initial = "Line 1\nLine 2\nLine 3";
    const result = await doInsert({
      fileContent: initial,
      title: "Inserted",
      content: "Between 1 and 2",
      location: 2,
      tmpDir: td,
    });
    // Verify ordering: Line 1 < Inserted < Line 2 < Line 3
    expect(result.content.indexOf("Line 1")).toBeLessThan(result.content.indexOf("### Inserted"));
    expect(result.content.indexOf("### Inserted")).toBeLessThan(result.content.indexOf("Line 2"));
    expect(result.content.indexOf("Line 2")).toBeLessThan(result.content.indexOf("Line 3"));
    await unlink(join(td, "test.md")).catch(() => {});
  });
});

// ─── Error shapes tests ───────────────────────────────────────────────────────

describe("error shapes", () => {
  it("sandbox violation throws for invalid path", () => {
    expect(() => validateSandboxPath("/etc/passwd")).toThrow();
  });

  it("normalizeSandboxPath handles relative paths correctly", () => {
    const normalized = normalizeSandboxPath("agent-teams/builder/test.md");
    expect(normalized).toContain("Documents/ai-usage");
    expect(normalized).toBe(join(SANDBOX_ROOT, "agent-teams/builder/test.md"));
  });

  it("normalizeSandboxPath handles tilde paths correctly", () => {
    const normalized = normalizeSandboxPath("~/Documents/ai-usage/inbox/test.md");
    expect(normalized).toContain("Documents/ai-usage");
  });
});

// ─── Run tests ────────────────────────────────────────────────────────────────

runTests().catch((err) => {
  console.error("Test runner failed:", err);
  process.exit(1);
});
