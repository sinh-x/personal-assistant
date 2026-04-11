/**
 * Unit tests for generatePrimer() extraObjective injection (PA-914)
 *
 * Self-contained test runner — type-checked via tsc, run via node.
 * Run: pnpm build && node dist/lib/__tests__/primer.objective.test.js
 */

import { homedir } from "node:os";
import { generatePrimer } from "../primer.js";
import type { TeamConfig } from "../types.js";

// ─── Test helpers ────────────────────────────────────────────────────────────

function makeMinimalTeamConfig(): TeamConfig {
  return {
    name: "test-team",
    description: "Test team for PA-914",
    agents: [],
    objective: "Test objective content",
  };
}

function makeResolveFile(): (relpath: string) => string | undefined {
  // Return undefined for all file lookups — tests don't need external files
  return () => undefined;
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
  notToContain(expected: string): void {
    if (typeof this.actual !== "string" || this.actual.includes(expected))
      throw new Error(`Expected string to NOT contain "${expected}", but it did`);
  }
  toBeDefined(): void {
    if (this.actual === undefined) throw new Error(`Expected defined, got undefined`);
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

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("generatePrimer extraObjective injection (PA-914)", () => {
  it("F914-1: with extraObjective produces ## Additional Instructions section", () => {
    const teamConfig = makeMinimalTeamConfig();
    const { content } = generatePrimer({
      deployId: "d-test001",
      teamName: "test-team",
      teamConfig,
      teamFile: "/fake/teams/test.yaml",
      deployTs: "2026-04-12T00:00:00+07:00",
      registryDb: "/fake/registry.db",
      deploymentsDir: "/fake/deployments",
      extraObjective: "my goal",
      resolveFile: makeResolveFile(),
      configDir: "/fake/config",
      homeDir: homedir(),
    });

    expect(content).toContain("## Additional Instructions");
    expect(content).toContain("my goal");
  });

  it("F914-2: without extraObjective does NOT produce ## Additional Instructions", () => {
    const teamConfig = makeMinimalTeamConfig();
    const { content } = generatePrimer({
      deployId: "d-test002",
      teamName: "test-team",
      teamConfig,
      teamFile: "/fake/teams/test.yaml",
      deployTs: "2026-04-12T00:00:00+07:00",
      registryDb: "/fake/registry.db",
      deploymentsDir: "/fake/deployments",
      resolveFile: makeResolveFile(),
      configDir: "/fake/config",
      homeDir: homedir(),
    });

    expect(content).notToContain("## Additional Instructions");
  });

  it("F914-3: objective text appears verbatim in primer output (no escaping)", () => {
    const teamConfig = makeMinimalTeamConfig();
    const objectiveText = "Phase 2: Test coverage for objective injection";
    const { content } = generatePrimer({
      deployId: "d-test003",
      teamName: "test-team",
      teamConfig,
      teamFile: "/fake/teams/test.yaml",
      deployTs: "2026-04-12T00:00:00+07:00",
      registryDb: "/fake/registry.db",
      deploymentsDir: "/fake/deployments",
      extraObjective: objectiveText,
      resolveFile: makeResolveFile(),
      configDir: "/fake/config",
      homeDir: homedir(),
    });

    // Objective text should appear exactly as provided
    expect(content).toContain(objectiveText);
  });

  it("AC5: given extraObjective 'my goal', primer contains ## Additional Instructions with 'my goal'", () => {
    const teamConfig = makeMinimalTeamConfig();
    const { content } = generatePrimer({
      deployId: "d-test004",
      teamName: "test-team",
      teamConfig,
      teamFile: "/fake/teams/test.yaml",
      deployTs: "2026-04-12T00:00:00+07:00",
      registryDb: "/fake/registry.db",
      deploymentsDir: "/fake/deployments",
      extraObjective: "my goal",
      resolveFile: makeResolveFile(),
      configDir: "/fake/config",
      homeDir: homedir(),
    });

    expect(content).toContain("## Additional Instructions");
    expect(content).toContain("\n\nmy goal\n");
  });

  it("AC6: without extraObjective, primer does NOT contain '## Additional Instructions'", () => {
    const teamConfig = makeMinimalTeamConfig();
    const { content } = generatePrimer({
      deployId: "d-test005",
      teamName: "test-team",
      teamConfig,
      teamFile: "/fake/teams/test.yaml",
      deployTs: "2026-04-12T00:00:00+07:00",
      registryDb: "/fake/registry.db",
      deploymentsDir: "/fake/deployments",
      resolveFile: makeResolveFile(),
      configDir: "/fake/config",
      homeDir: homedir(),
    });

    expect(content).notToContain("## Additional Instructions");
  });

  it("edge: extraObjective with special characters appears verbatim", () => {
    const teamConfig = makeMinimalTeamConfig();
    const specialText = "Test: <foo> & 'bar' \"baz\" `code` {{var}}";
    const { content } = generatePrimer({
      deployId: "d-test006",
      teamName: "test-team",
      teamConfig,
      teamFile: "/fake/teams/test.yaml",
      deployTs: "2026-04-12T00:00:00+07:00",
      registryDb: "/fake/registry.db",
      deploymentsDir: "/fake/deployments",
      extraObjective: specialText,
      resolveFile: makeResolveFile(),
      configDir: "/fake/config",
      homeDir: homedir(),
    });

    // Special characters should appear exactly as provided (no HTML escaping)
    expect(content).toContain(specialText);
  });

  it("edge: extraObjective with newlines appears verbatim", () => {
    const teamConfig = makeMinimalTeamConfig();
    const multilineText = "Line 1\nLine 2\nLine 3";
    const { content } = generatePrimer({
      deployId: "d-test007",
      teamName: "test-team",
      teamConfig,
      teamFile: "/fake/teams/test.yaml",
      deployTs: "2026-04-12T00:00:00+07:00",
      registryDb: "/fake/registry.db",
      deploymentsDir: "/fake/deployments",
      extraObjective: multilineText,
      resolveFile: makeResolveFile(),
      configDir: "/fake/config",
      homeDir: homedir(),
    });

    expect(content).toContain("Line 1");
    expect(content).toContain("Line 2");
    expect(content).toContain("Line 3");
  });
});

// ─── Run tests ────────────────────────────────────────────────────────────────

runTests().catch((err) => {
  console.error("Test runner failed:", err);
  process.exit(1);
});
