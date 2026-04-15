/**
 * `pa health` CLI command.
 * System health check with 6 categories and scored report.
 */

import { Command } from "commander";
import { getDb } from "../lib/registry-db.js";
import { loadConfig, computeOverallScore, getScoreLabel } from "../lib/health/score.js";
import { checkDeployments, checkAgents, checkTickets, checkCompliance, checkSchedules, checkInfrastructure } from "../lib/health/checks.js";
import type { HealthReport, HealthWindow, HealthCategory, CategoryResult } from "../lib/health/types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Output formatting
// ─────────────────────────────────────────────────────────────────────────────

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function colored(severity: string, text: string): string {
  switch (severity) {
    case "pass":
      return `${GREEN}${text}${RESET}`;
    case "warn":
      return `${YELLOW}${text}${RESET}`;
    case "fail":
      return `${RED}${BOLD}${text}${RESET}`;
    default:
      return text;
  }
}

function scoreColor(score: number, thresholds: { healthy: number; warning: number }): string {
  if (score >= thresholds.healthy) {
    return `${GREEN}${score}${RESET}`;
  }
  if (score >= thresholds.warning) {
    return `${YELLOW}${score}${RESET}`;
  }
  return `${RED}${BOLD}${score}${RESET}`;
}

/** Format a single finding for terminal output */
function formatFinding(finding: { severity: string; message: string; details?: string }): string {
  const icon = finding.severity === "pass" ? "✓" : finding.severity === "warn" ? "!" : "✗";
  const lines = [
    `  ${colored(finding.severity, icon)} ${finding.message}`,
  ];
  if (finding.details) {
    lines.push(`    → ${finding.details}`);
  }
  return lines.join("\n");
}

/** Print a category result */
function printCategory(cat: CategoryResult, thresholds: { healthy: number; warning: number }): void {
  console.log(`\n${BOLD}[${cat.name.toUpperCase()}]${RESET} Score: ${scoreColor(cat.score, thresholds)}/100`);

  if (cat.findings.length === 0) {
    console.log("  (no findings)");
    return;
  }

  for (const finding of cat.findings) {
    console.log(formatFinding(finding));
  }
}

/** Print the full health report */
function printReport(report: HealthReport, config: { thresholds: { healthy: number; warning: number } }): void {
  const { thresholds } = config;
  const label = report.scoreLabel.toUpperCase();

  console.log(`\n${BOLD}═══════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}  PA SYSTEM HEALTH REPORT${RESET}`);
  console.log(`${BOLD}═══════════════════════════════════════════${RESET}`);
  console.log(`\n  Overall Score: ${scoreColor(report.overallScore, thresholds)}/100 ${colored(report.scoreLabel, `[${label}]`)}`);
  console.log(`  Window: ${report.window.since.slice(0, 10)} to ${report.window.until.slice(0, 10)}`);
  console.log(`  Generated: ${report.generatedAt}`);

  for (const cat of report.categories) {
    printCategory(cat, thresholds);
  }

  console.log(`\n${BOLD}═══════════════════════════════════════════${RESET}`);
}

/** Print compact primer summary */
function printPrimerSummary(report: HealthReport): void {
  const scores = report.categories
    .map((c) => `${c.name}: ${c.score}`)
    .join(", ");
  console.log(`PA Health: ${report.overallScore}/100 [${report.scoreLabel}] ${scores}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Health snapshot persistence
// ─────────────────────────────────────────────────────────────────────────────

function saveSnapshot(report: HealthReport): void {
  const db = getDb();

  const categoriesJson = JSON.stringify(
    report.categories.map((c) => ({
      name: c.name,
      score: c.score,
      findingsCount: c.findings.length,
    }))
  );

  const findingsSummary = JSON.stringify({
    pass: report.categories.reduce((sum, c) => sum + c.findings.filter((f) => f.severity === "pass").length, 0),
    warn: report.categories.reduce((sum, c) => sum + c.findings.filter((f) => f.severity === "warn").length, 0),
    fail: report.categories.reduce((sum, c) => sum + c.findings.filter((f) => f.severity === "fail").length, 0),
  });

  db.prepare(`
    INSERT INTO health_snapshots (timestamp, overall_score, window_since, window_until, categories, findings_summary)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    report.generatedAt,
    report.overallScore,
    report.window.since,
    report.window.until,
    categoriesJson,
    findingsSummary
  );
}

function showHistory(): void {
  const db = getDb();

  const rows = db
    .prepare("SELECT * FROM health_snapshots ORDER BY timestamp DESC LIMIT 10")
    .all() as Record<string, unknown>[];

  if (rows.length === 0) {
    console.log("No health snapshots found.");
    return;
  }

  console.log("\nRecent Health Snapshots:\n");
  console.log(`${"TIMESTAMP".padEnd(25)} ${"SCORE".padEnd(8)} WINDOW`);
  console.log(`${"---------".padEnd(25)} ${"-----".padEnd(8)} ------`);

  for (const row of rows) {
    const ts = (row.timestamp as string).slice(0, 19).replace("T", " ");
    const score = row.overall_score as number;
    const window = `${(row.window_since as string).slice(0, 10)} → ${(row.window_until as string).slice(0, 10)}`;
    console.log(`${ts.padEnd(25)} ${score.toString().padEnd(8)} ${window}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Time window parsing
// ─────────────────────────────────────────────────────────────────────────────

function parseTimeWindow(since?: string, days?: number): HealthWindow {
  const until = new Date();
  let start: Date;

  if (since) {
    start = new Date(since);
    if (isNaN(start.getTime())) {
      console.error(`Invalid date: ${since}`);
      process.exit(1);
    }
  } else {
    // Default: today (last 24 hours or specified days)
    start = new Date(until);
    if (days !== undefined && days > 0) {
      start.setDate(start.getDate() - days);
    } else {
      start.setDate(start.getDate() - 1);
    }
  }

  return {
    since: start.toISOString(),
    until: until.toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main command
// ─────────────────────────────────────────────────────────────────────────────

export function createHealthCommand(): Command {
  const cmd = new Command("health");

  cmd.description("PA system health check — single view of deployment health, agent behavior, compliance, and infrastructure");

  cmd.option("--json", "Output as JSON");
  cmd.option("--days <n>", "Analysis window in days (default: 1)");
  cmd.option("--since <date>", "Start of analysis window (ISO date)");
  cmd.option("--primer-summary", "Compact output for agent primer injection");
  cmd.option("--history", "Show recent health score history");

  cmd.argument("[category]", "Category to check: deployments, agents, tickets, compliance, schedules, infrastructure");

  cmd.action(async (category: string | undefined, opts: { json?: boolean; days?: string; since?: string; primerSummary?: boolean; history?: boolean }) => {
    // Show history if requested
    if (opts.history) {
      showHistory();
      return;
    }

    // Parse time window
    const daysNum = opts.days ? parseInt(opts.days, 10) : undefined;
    const window = parseTimeWindow(opts.since, daysNum);

    // Load config
    const config = loadConfig();

    // Run category checks
    let categories: CategoryResult[];

    if (category) {
      // Single category
      const catName = category as HealthCategory;
      let result: CategoryResult;

      switch (catName) {
        case "deployments":
          result = checkDeployments(window);
          break;
        case "agents":
          result = checkAgents(window);
          break;
        case "tickets":
          result = checkTickets(window);
          break;
        case "compliance":
          result = checkCompliance(window);
          break;
        case "schedules":
          result = checkSchedules();
          break;
        case "infrastructure":
          result = checkInfrastructure(window);
          break;
        default:
          console.error(`Unknown category: ${category}`);
          console.error("Valid categories: deployments, agents, tickets, compliance, schedules, infrastructure");
          process.exit(1);
      }

      categories = [result];
    } else {
      // All categories
      categories = [
        checkDeployments(window),
        checkAgents(window),
        checkTickets(window),
        checkCompliance(window),
        checkSchedules(),
        checkInfrastructure(window),
      ];
    }

    // Compute overall score
    const overallScore = computeOverallScore(categories, config.weights);
    const scoreLabel = getScoreLabel(overallScore, config.thresholds);

    const report: HealthReport = {
      overallScore,
      scoreLabel,
      categories,
      window,
      generatedAt: new Date().toISOString(),
    };

    // Save snapshot (only for full report, not single category)
    if (!category) {
      try {
        saveSnapshot(report);
      } catch (err) {
        console.error("Warning: Could not save health snapshot:", err);
      }
    }

    // Output
    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else if (opts.primerSummary) {
      printPrimerSummary(report);
    } else {
      printReport(report, config);
    }
  });

  return cmd;
}
