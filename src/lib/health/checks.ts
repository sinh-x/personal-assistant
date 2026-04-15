/**
 * Health check functions for `pa health` command.
 * Implements 6 category checks: deployments, agents, tickets, compliance, schedules, infrastructure.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import { expandHome, getDeploymentsDir, getTicketsDir } from "../paths.js";
import { getDb } from "../registry-db.js";
import { isProcessAlive } from "../../utils/process.js";
import { parseActivityLog } from "./activity.js";
import type {
  HealthFinding,
  HealthWindow,
  CategoryResult,
  HealthCategory,
} from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Utility functions
// ─────────────────────────────────────────────────────────────────────────────

/** Make a finding */
function finding(
  severity: HealthFinding["severity"],
  category: HealthCategory,
  message: string,
  details?: string
): HealthFinding {
  return { severity, category, message, details };
}

/** Score a category based on findings */
function scoreCategory(findings: HealthFinding[]): number {
  const failCount = findings.filter((f) => f.severity === "fail").length;
  const warnCount = findings.filter((f) => f.severity === "warn").length;
  const score = 100 - failCount * 15 - warnCount * 5;
  return Math.max(0, Math.min(100, score));
}

// ─────────────────────────────────────────────────────────────────────────────
// Deployments check
// ─────────────────────────────────────────────────────────────────────────────

export function checkDeployments(window: HealthWindow): CategoryResult {
  const category: HealthCategory = "deployments";
  const findings: HealthFinding[] = [];

  const db = getDb();

  const rows = db
    .prepare(
      `SELECT * FROM deployments WHERE started_at >= ? AND started_at <= ? ORDER BY started_at DESC`
    )
    .all(window.since, window.until) as Record<string, unknown>[];

  if (rows.length === 0) {
    findings.push(finding("pass", category, "No deployments in the analysis window"));
    return { name: category, score: 100, findings };
  }

  let successCount = 0;
  let failCount = 0;
  let crashCount = 0;
  let orphanCount = 0;
  let fallbackCount = 0;
  let totalRuntime = 0;
  let completedCount = 0;

  for (const row of rows) {
    const status = row.status as string;

    if (status === "success" || status === "partial") {
      successCount++;
    } else if (status === "failed") {
      failCount++;
    } else if (status === "crashed") {
      crashCount++;
    }

    if (row.fallback) {
      fallbackCount++;
    }

    // Check for orphans: running but PID dead
    if (status === "running") {
      const pid = row.pid as number | undefined;
      if (pid !== undefined && !isProcessAlive(pid)) {
        orphanCount++;
        findings.push(
          finding(
            "fail",
            category,
            `Orphaned deployment: ${row.deployment_id} (PID ${pid} dead, no completion marker)`,
            `Started: ${row.started_at}`
          )
        );
      }
    }

    // Calculate runtime
    if (row.completed_at && row.started_at) {
      const start = new Date(row.started_at as string).getTime();
      const end = new Date(row.completed_at as string).getTime();
      if (!isNaN(start) && !isNaN(end)) {
        totalRuntime += end - start;
        completedCount++;
      }
    }
  }

  const total = rows.length;
  const successRate = total > 0 ? (successCount / total) * 100 : 0;

  findings.push(
    finding(
      "pass",
      category,
      `Deployments analyzed: ${total}`,
      `Success: ${successCount}, Failed: ${failCount}, Crashed: ${crashCount}`
    )
  );

  if (successRate >= 80) {
    findings.push(finding("pass", category, `Success rate: ${successRate.toFixed(1)}%`));
  } else if (successRate >= 60) {
    findings.push(
      finding("warn", category, `Success rate below healthy threshold: ${successRate.toFixed(1)}%`)
    );
  } else {
    findings.push(
      finding(
        "fail",
        category,
        `Success rate critically low: ${successRate.toFixed(1)}%`,
        `${failCount} failed, ${crashCount} crashed out of ${total} deployments`
      )
    );
  }

  if (orphanCount > 0) {
    findings.push(
      finding("fail", category, `${orphanCount} orphaned deployment(s) detected`)
    );
  } else {
    findings.push(finding("pass", category, "No orphaned deployments"));
  }

  if (fallbackCount > 0) {
    findings.push(
      finding(
        "warn",
        category,
        `${fallbackCount} deployment(s) resolved via fallback marker`,
        "System resolved these deployments"
      )
    );
  }

  if (completedCount > 0) {
    const avgRuntimeMs = totalRuntime / completedCount;
    const avgRuntimeMin = avgRuntimeMs / 60000;
    findings.push(
      finding(
        "pass",
        category,
        `Average deployment runtime: ${avgRuntimeMin.toFixed(1)} minutes`
      )
    );
  }

  return {
    name: category,
    score: scoreCategory(findings),
    findings,
    stats: {
      total,
      successCount,
      failCount,
      crashCount,
      orphanCount,
      fallbackCount,
      successRate,
      avgRuntimeMs: completedCount > 0 ? totalRuntime / completedCount : 0,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Agents check
// ─────────────────────────────────────────────────────────────────────────────

export function checkAgents(window: HealthWindow): CategoryResult {
  const category: HealthCategory = "agents";
  const findings: HealthFinding[] = [];

  const db = getDb();

  const rows = db
    .prepare(
      `SELECT * FROM deployments WHERE started_at >= ? AND started_at <= ? ORDER BY started_at DESC`
    )
    .all(window.since, window.until) as Record<string, unknown>[];

  if (rows.length === 0) {
    findings.push(finding("pass", category, "No deployments to analyze agent behavior"));
    return { name: category, score: 100, findings };
  }

  let totalToolCalls = 0;
  let totalFailures = 0;
  let deploymentsWithErrorLoops = 0;
  let deploymentsAnalyzed = 0;
  const teamRatings: Record<string, { total: number; count: number }> = {};

  for (const row of rows) {
    const deployId = row.deployment_id as string;

    // Analyze activity log for this deployment
    const activity = parseActivityLog(deployId);
    if (activity.totalCalls > 0) {
      deploymentsAnalyzed++;
      totalToolCalls += activity.totalCalls;
      totalFailures += activity.failures;

      if (activity.errorLoops.length > 0) {
        deploymentsWithErrorLoops++;
        findings.push(
          finding(
            "fail",
            category,
            `Deployment ${deployId}: ${activity.errorLoops.length} error loop(s) detected`,
            activity.errorLoops
              .map((l) => `Agent ${l.agent}: ${l.consecutiveCount} consecutive failures`)
              .join("; ")
          )
        );
      }
    }

    // Collect ratings by team
    if (row.rating) {
      const team = row.team as string;
      try {
        const rating = JSON.parse(row.rating as string);
        if (rating.overall !== undefined) {
          const existing = teamRatings[team] ?? { total: 0, count: 0 };
          existing.total += rating.overall;
          existing.count++;
          teamRatings[team] = existing;
        }
      } catch {
        // Invalid rating JSON
      }
    }
  }

  if (deploymentsAnalyzed === 0) {
    findings.push(finding("pass", category, "No activity logs found for analysis"));
  } else {
    const overallErrorRate = totalToolCalls > 0 ? totalFailures / totalToolCalls : 0;

    if (overallErrorRate > 0.1) {
      findings.push(
        finding(
          "fail",
          category,
          `High tool failure rate: ${(overallErrorRate * 100).toFixed(1)}%`,
          `${totalFailures} failures out of ${totalToolCalls} calls`
        )
      );
    } else if (overallErrorRate > 0.05) {
      findings.push(
        finding(
          "warn",
          category,
          `Elevated tool failure rate: ${(overallErrorRate * 100).toFixed(1)}%`
        )
      );
    } else {
      findings.push(
        finding(
          "pass",
          category,
          `Tool failure rate: ${(overallErrorRate * 100).toFixed(1)}%`,
          `${totalFailures} failures out of ${totalToolCalls} calls`
        )
      );
    }

    if (deploymentsWithErrorLoops > 0) {
      findings.push(
        finding(
          "warn",
          category,
          `${deploymentsWithErrorLoops} deployment(s) with error loops detected`
        )
      );
    } else {
      findings.push(finding("pass", category, "No error loops detected"));
    }
  }

  // Report team ratings
  for (const [team, data] of Object.entries(teamRatings)) {
    const avgRating = data.total / data.count;
    if (avgRating >= 4) {
      findings.push(
        finding("pass", category, `Team ${team}: avg rating ${avgRating.toFixed(1)}/5`)
      );
    } else if (avgRating >= 3) {
      findings.push(
        finding("warn", category, `Team ${team}: avg rating ${avgRating.toFixed(1)}/5 (below healthy)`)
      );
    } else {
      findings.push(
        finding(
          "fail",
          category,
          `Team ${team}: avg rating ${avgRating.toFixed(1)}/5 (critically low)`,
          `${data.count} rated deployments`
        )
      );
    }
  }

  if (Object.keys(teamRatings).length === 0) {
    findings.push(finding("warn", category, "No self-reported ratings found"));
  }

  return {
    name: category,
    score: scoreCategory(findings),
    findings,
    stats: {
      deploymentsAnalyzed,
      totalToolCalls,
      totalFailures,
      errorRate: totalToolCalls > 0 ? totalFailures / totalToolCalls : 0,
      deploymentsWithErrorLoops,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tickets check
// ─────────────────────────────────────────────────────────────────────────────

export function checkTickets(window: HealthWindow): CategoryResult {
  const category: HealthCategory = "tickets";
  const findings: HealthFinding[] = [];

  const ticketsDir = getTicketsDir();

  if (!existsSync(ticketsDir)) {
    findings.push(finding("pass", category, "No ticket store found"));
    return { name: category, score: 100, findings };
  }

  const files = readdirSync(ticketsDir).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    findings.push(finding("pass", category, "No tickets found"));
    return { name: category, score: 100, findings };
  }

  const now = Date.now();
  const windowStart = new Date(window.since).getTime();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const threeDaysMs = 3 * 24 * 60 * 60 * 1000;

  let staleCount = 0;
  let missingDocRefCount = 0;
  let blockedNoCommentCount = 0;
  const statusCounts: Record<string, number> = {};
  const HANDOFF_STATUSES = new Set(["pending-approval", "review-uat"]);

  for (const file of files) {
    try {
      const ticketPath = resolve(ticketsDir, file);
      const content = readFileSync(ticketPath, "utf-8");
      const ticket = JSON.parse(content);

      // Count by status
      const status = ticket.status ?? "unknown";
      statusCounts[status] = (statusCounts[status] ?? 0) + 1;

      // Check stale: active status, no update >7 days, and ticket was updated within window
      if (ticket.updatedAt) {
        const updatedAt = new Date(ticket.updatedAt).getTime();
        const age = now - updatedAt;
        // Only flag tickets updated within the window period (relevant to current health)
        if (updatedAt >= windowStart && age > sevenDaysMs && !["done", "rejected", "cancelled"].includes(status)) {
          staleCount++;
          findings.push(
            finding(
              "fail",
              category,
              `Stale ticket: ${ticket.id}`,
              `No update for ${Math.floor(age / (24 * 60 * 60 * 1000))} days, status: ${status}`
            )
          );
        }
      }

      // Check handoff statuses without doc_refs
      if (HANDOFF_STATUSES.has(status)) {
        const hasDocRefs = ticket.doc_refs && ticket.doc_refs.length > 0;
        const hasNeedsDocRefTag = ticket.tags && ticket.tags.includes("needs-doc-ref");
        if (!hasDocRefs || hasNeedsDocRefTag) {
          missingDocRefCount++;
          findings.push(
            finding(
              "fail",
              category,
              `Handoff ticket missing doc_refs: ${ticket.id}`,
              `Status: ${status}`
            )
          );
        }
      }

      // Check blocked tickets without recent comments
      if (ticket.tags && ticket.tags.includes("blocked")) {
        const comments = ticket.comments ?? [];
        const lastCommentTime = comments.length > 0
          ? Math.max(...comments.map((c: { timestamp?: string }) =>
              c.timestamp ? new Date(c.timestamp).getTime() : 0
            ))
          : 0;

        if (lastCommentTime > 0 && now - lastCommentTime > threeDaysMs) {
          blockedNoCommentCount++;
          findings.push(
            finding(
              "warn",
              category,
              `Blocked ticket without recent comment: ${ticket.id}`,
              `Last comment ${Math.floor((now - lastCommentTime) / (24 * 60 * 60 * 1000))} days ago`
            )
          );
        }
      }
    } catch {
      // Skip malformed tickets
    }
  }

  findings.push(
    finding("pass", category, `Tickets analyzed: ${files.length}`, "Status distribution: " +
      Object.entries(statusCounts)
        .map(([s, c]) => `${s}: ${c}`)
        .join(", "))
  );

  if (staleCount > 0) {
    findings.push(
      finding("fail", category, `${staleCount} stale ticket(s) detected`)
    );
  } else {
    findings.push(finding("pass", category, "No stale tickets"));
  }

  if (missingDocRefCount > 0) {
    findings.push(
      finding("fail", category, `${missingDocRefCount} handoff ticket(s) missing doc_refs`)
    );
  } else {
    findings.push(finding("pass", category, "All handoff tickets have doc_refs"));
  }

  return {
    name: category,
    score: scoreCategory(findings),
    findings,
    stats: { total: files.length, staleCount, missingDocRefCount, blockedNoCommentCount },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Compliance check
// ─────────────────────────────────────────────────────────────────────────────

export function checkCompliance(window: HealthWindow): CategoryResult {
  const category: HealthCategory = "compliance";
  const findings: HealthFinding[] = [];

  const db = getDb();

  const rows = db
    .prepare(
      `SELECT * FROM deployments WHERE started_at >= ? AND started_at <= ? ORDER BY started_at DESC`
    )
    .all(window.since, window.until) as Record<string, unknown>[];

  if (rows.length === 0) {
    findings.push(finding("pass", category, "No deployments to check compliance"));
    return { name: category, score: 100, findings };
  }

  let missingSessionLogs = 0;
  let missingRating = 0;
  let malformedSessionLogs = 0;

  const REQUIRED_SECTIONS = ["## Session Rating", "## Timeline", "## What Happened"];

  for (const row of rows) {
    const deployId = row.deployment_id as string;
    const logFile = row.log_file as string | undefined;

    // Check if session log exists
    if (logFile) {
      const fullPath = resolve(expandHome("~"), logFile.replace(/^~\//, ""));
      if (!existsSync(fullPath)) {
        missingSessionLogs++;
        findings.push(
          finding(
            "fail",
            category,
            `Deployment ${deployId}: session log not found on disk`,
            `Expected: ${fullPath}`
          )
        );
      } else {
        // Check required sections in session log
        try {
          const content = readFileSync(fullPath, "utf-8");
          for (const section of REQUIRED_SECTIONS) {
            if (!content.includes(section)) {
              malformedSessionLogs++;
              findings.push(
                finding(
                  "warn",
                  category,
                  `Deployment ${deployId}: session log missing "${section}"`,
                  logFile
                )
              );
              break; // Only report once per deployment
            }
          }
        } catch {
          // Can't read file
        }
      }
    } else {
      // No log_file in registry
      missingSessionLogs++;
    }

    // Check for rating in completion
    if (!row.rating) {
      const status = row.status as string;
      if (status === "success" || status === "partial") {
        missingRating++;
        findings.push(
          finding(
            "warn",
            category,
            `Deployment ${deployId}: completion marker missing rating data`,
            `Status: ${status}`
          )
        );
      }
    }
  }

  findings.push(
    finding(
      "pass",
      category,
      `Compliance checked: ${rows.length} deployment(s)`
    )
  );

  if (missingSessionLogs === 0) {
    findings.push(finding("pass", category, "All session logs accessible"));
  }

  if (missingRating === 0) {
    findings.push(finding("pass", category, "All completion markers have ratings"));
  }

  return {
    name: category,
    score: scoreCategory(findings),
    findings,
    stats: { missingSessionLogs, missingRating, malformedSessionLogs },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Schedules check
// ─────────────────────────────────────────────────────────────────────────────

export function checkSchedules(): CategoryResult {
  const category: HealthCategory = "schedules";
  const findings: HealthFinding[] = [];

  try {
    const output = execSync("systemctl --user list-timers 'pa-*' --no-pager", {
      encoding: "utf-8",
      stdio: ["inherit", "pipe", "inherit"],
    });

    const lines = output.split("\n");
    let timerCount = 0;
    let inactiveCount = 0;

    // Parse timer lines (typically next 7 lines after header)
    let inTimerSection = false;
    for (const line of lines) {
      if (line.includes("NEXT") || line.includes("LOAD")) {
        inTimerSection = true;
        continue;
      }
      if (!inTimerSection) continue;

      // Skip separator lines and empty lines
      if (line.match(/^──/) || line.trim() === "") continue;

      // Timer line format from systemctl --user list-timers 'pa-*':
      // Columns are separated by varying whitespace (2+ spaces between columns,
      // but timestamps contain spaces). We use regex to find the UNIT column
      // directly - it always starts with 'pa-' and ends with '.timer'.
      const unitMatch = line.match(/(pa-[a-zA-Z0-9_-]+\.timer)/);
      if (!unitMatch) continue;

      timerCount++;
      const unit = unitMatch[1];

      // ACTIVATES column is the service this timer activates (pa-*.service)
      const activatesMatch = line.match(/(pa-[a-zA-Z0-9_-]+\.service)\s*$/);
      const activates = activatesMatch ? activatesMatch[1] : "";

      // Check the actual timer active state via systemctl show
      // This gives the real state (active/inactive) regardless of whether
      // the service it activates is running
      let isActive = true;
      try {
        const stateOutput = execSync(`systemctl --user show '${unit}' -p ActiveState --value`, {
          encoding: "utf-8",
          stdio: ["inherit", "pipe", "inherit"],
        });
        isActive = stateOutput.trim().toLowerCase() === "active";
      } catch {
        // If we can't query, assume inactive
        isActive = false;
      }

      if (!isActive) {
        inactiveCount++;
        findings.push(
          finding(
            "fail",
            category,
            `Inactive timer: ${unit}`,
            `Activates: ${activates}`
          )
        );
      }
    }

    findings.push(
      finding(
        "pass",
        category,
        `PA timers analyzed: ${timerCount}`,
        inactiveCount > 0 ? `${inactiveCount} inactive` : "All active"
      )
    );

    if (inactiveCount === 0) {
      findings.push(finding("pass", category, "All PA timers are active"));
    }
  } catch {
    findings.push(
      finding(
        "warn",
        category,
        "Could not query systemd timers",
        "systemctl command failed"
      )
    );
  }

  return {
    name: category,
    score: scoreCategory(findings),
    findings,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Infrastructure check
// ─────────────────────────────────────────────────────────────────────────────

export function checkInfrastructure(window: HealthWindow): CategoryResult {
  const category: HealthCategory = "infrastructure";
  const findings: HealthFinding[] = [];

  const db = getDb();

  const rows = db
    .prepare(
      `SELECT * FROM deployments WHERE started_at >= ? AND started_at <= ? ORDER BY started_at DESC`
    )
    .all(window.since, window.until) as Record<string, unknown>[];

  if (rows.length === 0) {
    findings.push(finding("pass", category, "No deployments to check infrastructure"));
    return { name: category, score: 100, findings };
  }

  const deploymentsDir = getDeploymentsDir();
  let missingWorkspace = 0;
  let missingLogFile = 0;

  for (const row of rows) {
    const deployId = row.deployment_id as string;
    const status = row.status as string;

    // Check workspace directory exists for running deployments
    if (status === "running") {
      const workspacePath = resolve(deploymentsDir, deployId);
      if (!existsSync(workspacePath)) {
        missingWorkspace++;
        findings.push(
          finding(
            "fail",
            category,
            `Deployment ${deployId}: workspace directory missing`,
            `Expected: ${workspacePath}`
          )
        );
      }
    }

    // Check session log file exists
    const logFile = row.log_file as string | undefined;
    if (logFile) {
      const fullPath = resolve(expandHome("~"), logFile.replace(/^~\//, ""));
      if (!existsSync(fullPath)) {
        missingLogFile++;
        findings.push(
          finding(
            "fail",
            category,
            `Deployment ${deployId}: session log file missing`,
            `Expected: ${fullPath}`
          )
        );
      }
    }
  }

  findings.push(
    finding(
      "pass",
      category,
      `Infrastructure checked: ${rows.length} deployment(s)`
    )
  );

  if (missingWorkspace === 0 && missingLogFile === 0) {
    findings.push(finding("pass", category, "All infrastructure references valid"));
  }

  return {
    name: category,
    score: scoreCategory(findings),
    findings,
    stats: { missingWorkspace, missingLogFile },
  };
}
