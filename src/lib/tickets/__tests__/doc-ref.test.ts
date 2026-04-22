/**
 * Unit tests for doc-ref helpers (Phase 4.1, PA-1210)
 *
 * Self-contained test runner. Run: pnpm build && node dist/lib/tickets/__tests__/doc-ref.test.js
 */

import { normalizeDocRefType, formatDocRefBadge, deriveDocRefTitle } from "../doc-ref.js";

// ─── Test framework ────────────────────────────────────────────────────────────

type TestFn = () => void | Promise<void>;
const tests: Array<{ name: string; fn: TestFn }> = [];

function describe(_name: string, fn: () => void): void { fn(); }
function it(name: string, fn: TestFn): void { tests.push({ name, fn }); }

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
  notToContain(expected: string): void {
    if (typeof this.actual !== "string" || this.actual.includes(expected))
      throw new Error(`Expected string to NOT contain "${expected}", but it did`);
  }
}

function expect(actual: unknown): Assertion { return new Assertion(actual); }

// ─── normalizeDocRefType tests ────────────────────────────────────────────────

describe("normalizeDocRefType", () => {
  it("pass-through: 'req' stays 'req'", () => {
    expect(normalizeDocRefType("req")).toBe("req");
  });
  it("pass-through: 'uat' stays 'uat'", () => {
    expect(normalizeDocRefType("uat")).toBe("uat");
  });
  it("pass-through: 'impl' stays 'impl'", () => {
    expect(normalizeDocRefType("impl")).toBe("impl");
  });
  it("alias: 'requirements' → 'req'", () => {
    expect(normalizeDocRefType("requirements")).toBe("req");
  });
  it("alias: 'implementation' → 'impl'", () => {
    expect(normalizeDocRefType("implementation")).toBe("impl");
  });
  it("case: 'IMPLEMENTATION' → 'impl'", () => {
    expect(normalizeDocRefType("IMPLEMENTATION")).toBe("impl");
  });
  it("case: 'REQUIREMENTS' → 'req' (lowercased then alias-matched)", () => {
    // normalize lowercases first, then alias-maps: REQUIREMENTS → requirements → req
    expect(normalizeDocRefType("REQUIREMENTS")).toBe("req");
  });
  it("unknown: 'weirdtype' → 'weirdtype'", () => {
    expect(normalizeDocRefType("weirdtype")).toBe("weirdtype");
  });
});

// ─── formatDocRefBadge tests ──────────────────────────────────────────────────

describe("formatDocRefBadge", () => {
  it('primary req → "[★REQ]"', () => {
    expect(formatDocRefBadge({ type: "req", primary: true })).toBe("[★REQ]");
  });
  it('non-primary uat → "[UAT]"', () => {
    expect(formatDocRefBadge({ type: "uat", primary: false })).toBe("[UAT]");
  });
  it('primary impl → "[★IMPL]"', () => {
    expect(formatDocRefBadge({ type: "impl", primary: true })).toBe("[★IMPL]");
  });
  it("unknown type renders uppercase → '[WEIRDTYPE]'", () => {
    expect(formatDocRefBadge({ type: "weirdtype", primary: false })).toBe("[WEIRDTYPE]");
  });
  it("long-form alias 'requirements' displays as 'REQ'", () => {
    // The type itself is not aliased in the badge — normalizeDocRefType handles aliasing
    // formatDocRefBadge uses raw type or DOC_REF_TYPE_DISPLAY lookup
    expect(formatDocRefBadge({ type: "requirements", primary: false })).toBe("[REQ]");
  });
});

// ─── deriveDocRefTitle tests ──────────────────────────────────────────────────

describe("deriveDocRefTitle", () => {
  it("non-.md path returns raw path (spec: non-markdown → raw path)", () => {
    const title = deriveDocRefTitle({ type: "attachment", path: "~/Documents/ai-usage/sinh-inputs/2026-04-22-notes.txt" });
    expect(title).toBe("~/Documents/ai-usage/sinh-inputs/2026-04-22-notes.txt");
  });

  it("non-existent .md file falls back to stripped filename without crashing", () => {
    // No such file, so H1/frontmatter lookup fails → filename fallback
    // basename("2026-04-22-does-not-exist.md") = "2026-04-22-does-not-exist.md"
    // strip YYYY-MM-DD- and .md → "does-not-exist"
    const title = deriveDocRefTitle({ type: "req", path: "~/Documents/ai-usage/nonexistent/2026-04-22-does-not-exist.md" });
    expect(title).toBe("does-not-exist");
  });

  it("non-.md path returns raw path (spec: non-markdown → raw path)", () => {
    const title = deriveDocRefTitle({ type: "url", path: "https://example.com/doc.html" });
    expect(title).toBe("https://example.com/doc.html");
  });

  it("absolute path without tilde still works", () => {
    const title = deriveDocRefTitle({ type: "attachment", path: "/tmp/2026-04-22-notes.md" });
    expect(title).toBe("notes");
  });
});

// ─── Run tests ────────────────────────────────────────────────────────────────

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

runTests().catch((err) => {
  console.error("Test runner failed:", err);
  process.exit(1);
});