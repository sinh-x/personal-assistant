/**
 * Scoring utilities for `pa health` command.
 * Handles config loading and score computation.
 */

import { existsSync, readFileSync } from "node:fs";
import { getHealthConfigPath } from "../paths.js";
import yaml from "js-yaml";
import type { HealthConfig, HealthCategory, CategoryResult } from "./types.js";

/** Default weights if no config file */
const DEFAULT_WEIGHTS: Record<HealthCategory, number> = {
  deployments: 20,
  agents: 20,
  tickets: 20,
  compliance: 20,
  schedules: 10,
  infrastructure: 10,
};

/** Default thresholds */
const DEFAULT_THRESHOLDS = {
  healthy: 80,
  warning: 60,
};

/**
 * Load health config from health.yaml.
 * Falls back to defaults if file doesn't exist.
 */
export function loadConfig(): HealthConfig {
  const configPath = getHealthConfigPath();

  if (!existsSync(configPath)) {
    return {
      weights: { ...DEFAULT_WEIGHTS },
      thresholds: { ...DEFAULT_THRESHOLDS },
    };
  }

  try {
    const content = readFileSync(configPath, "utf-8");
    const config = yaml.load(content) as Record<string, Record<string, unknown>>;

    const weights: Record<HealthCategory, number> = { ...DEFAULT_WEIGHTS };
    if (config.weights) {
      for (const [key, value] of Object.entries(config.weights)) {
        if (key in weights && typeof value === "number") {
          weights[key as HealthCategory] = value;
        }
      }
    }

    const thresholds = { ...DEFAULT_THRESHOLDS };
    if (config.thresholds) {
      if (typeof config.thresholds.healthy === "number") {
        thresholds.healthy = config.thresholds.healthy;
      }
      if (typeof config.thresholds.warning === "number") {
        thresholds.warning = config.thresholds.warning;
      }
    }

    return { weights, thresholds };
  } catch {
    return {
      weights: { ...DEFAULT_WEIGHTS },
      thresholds: { ...DEFAULT_THRESHOLDS },
    };
  }
}

/**
 * Compute the overall score as a weighted average of category scores.
 */
export function computeOverallScore(
  categories: CategoryResult[],
  weights: Partial<Record<HealthCategory, number>>
): number {
  let totalWeight = 0;
  let weightedSum = 0;

  for (const cat of categories) {
    const weight = weights[cat.name] ?? DEFAULT_WEIGHTS[cat.name] ?? 0;
    if (weight > 0) {
      weightedSum += cat.score * weight;
      totalWeight += weight;
    }
  }

  if (totalWeight === 0) {
    return 100;
  }

  return Math.round(weightedSum / totalWeight);
}

/**
 * Get the score label based on thresholds.
 */
export function getScoreLabel(
  score: number,
  thresholds: { healthy: number; warning: number }
): "healthy" | "warning" | "unhealthy" {
  if (score >= thresholds.healthy) {
    return "healthy";
  }
  if (score >= thresholds.warning) {
    return "warning";
  }
  return "unhealthy";
}
