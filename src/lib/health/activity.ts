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
 * Tracks consecutive failures per agent, resetting the count on any tool_success
 * or tool_call event. Only flags when there are genuinely N consecutive failures
 * with no successes in between.
 */
export function detectErrorLoops(events: ActivityEvent[]): ActivityAnalysis["errorLoops"] {
  const loops: ActivityAnalysis["errorLoops"] = [];

  // Group events by agent, preserving chronological order
  const agentEvents = new Map<string, ActivityEvent[]>();
  for (const evt of events) {
    if (evt.event === "tool_call" || evt.event === "tool_success" || evt.event === "tool_failure") {
      const existing = agentEvents.get(evt.agent) ?? [];
      existing.push(evt);
      agentEvents.set(evt.agent, existing);
    }
  }

  // Check each agent for consecutive failure sequences
  for (const [agent, evts] of agentEvents) {
    // Events are already in chronological order from the JSONL
    let consecutiveCount = 0;
    let firstTs = "";

    for (const evt of evts) {
      if (evt.event === "tool_failure") {
        if (consecutiveCount === 0) {
          firstTs = evt.ts;
        }
        consecutiveCount++;

        if (consecutiveCount >= ERROR_LOOP_THRESHOLD) {
          loops.push({
            agent,
            consecutiveCount,
            firstTs,
          });
          // Reset after finding a loop — next failure starts fresh
          consecutiveCount = 0;
          firstTs = "";
        }
      } else {
        // tool_call or tool_success resets the consecutive counter
        consecutiveCount = 0;
        firstTs = "";
      }
    }
  }

  return loops;
}
