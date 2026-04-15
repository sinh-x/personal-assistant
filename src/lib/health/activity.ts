/**
 * Activity log parser for `pa health` command.
 * Parses activity.jsonl files to detect error patterns and tool failures.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expandHome } from "../paths.js";
import type { ActivityEvent, ActivityAnalysis } from "./types.js";

/** Minimum consecutive failures to count as an error loop */
const ERROR_LOOP_THRESHOLD = 3;

/**
 * Parse an activity.jsonl file for a deployment.
 * Returns analysis including error rates and detected error loops.
 */
export function parseActivityLog(deployId: string): ActivityAnalysis {
  const activityPath = resolve(
    expandHome("~/Documents/ai-usage/deployments"),
    deployId,
    "activity.jsonl"
  );

  const result: ActivityAnalysis = {
    deployId,
    totalCalls: 0,
    failures: 0,
    errorRate: 0,
    errorLoops: [],
  };

  if (!existsSync(activityPath)) {
    return result;
  }

  const raw = readFileSync(activityPath, "utf-8").trim();
  if (!raw) {
    return result;
  }

  const lines = raw.split("\n").filter((l) => l.trim());
  const events: ActivityEvent[] = [];

  for (const line of lines) {
    try {
      const evt = JSON.parse(line) as ActivityEvent;
      events.push(evt);
    } catch {
      // Skip malformed lines
    }
  }

  // Count tool calls and failures
  let toolCalls = 0;
  let failures = 0;

  for (const evt of events) {
    if (evt.event === "tool_call" || evt.event === "tool_success" || evt.event === "tool_failure") {
      toolCalls++;
      if (evt.event === "tool_failure") {
        failures++;
      }
    }
  }

  result.totalCalls = toolCalls;
  result.failures = failures;
  result.errorRate = toolCalls > 0 ? failures / toolCalls : 0;

  // Detect error loops
  result.errorLoops = detectErrorLoops(events);

  return result;
}

/**
 * Detect error loops — 3+ consecutive tool_failure events by the same agent.
 */
export function detectErrorLoops(events: ActivityEvent[]): ActivityAnalysis["errorLoops"] {
  const loops: ActivityAnalysis["errorLoops"] = [];

  // Group events by agent
  const agentEvents = new Map<string, ActivityEvent[]>();
  for (const evt of events) {
    if (evt.event === "tool_failure") {
      const existing = agentEvents.get(evt.agent) ?? [];
      existing.push(evt);
      agentEvents.set(evt.agent, existing);
    }
  }

  // Check each agent for consecutive failures
  for (const [agent, failEvents] of agentEvents) {
    // Sort by timestamp
    const sorted = failEvents.sort((a, b) => a.ts.localeCompare(b.ts));

    let consecutiveCount = 0;
    let firstTs = "";

    for (const evt of sorted) {
      if (firstTs === "") {
        firstTs = evt.ts;
        consecutiveCount = 1;
      } else {
        // Check if this failure is within a reasonable window (consecutive in the log)
        consecutiveCount++;

        if (consecutiveCount >= ERROR_LOOP_THRESHOLD) {
          loops.push({
            agent,
            consecutiveCount,
            firstTs,
          });
          // Reset after finding a loop
          firstTs = "";
          consecutiveCount = 0;
        }
      }
    }
  }

  return loops;
}
