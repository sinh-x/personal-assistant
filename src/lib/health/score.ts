/**
 * Scoring utilities for `pa health` command.
 * Handles config loading and score computation.
 */

import { existsSync, readFileSync } from "node:fs";
import { getHealthConfigPath } from "../paths.js";
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
    // Simple YAML-like parsing for weights and thresholds
    const config = parseSimpleYaml(content);

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
 * Simple YAML-like parser for health config.
 * Handles only the structure we need: weights and thresholds.
 */
function parseSimpleYaml(content: string): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  let currentSection: string | null = null;
  let currentValues: Record<string, unknown> = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (trimmed.startsWith("#") || trimmed === "") continue;

    // Check for section header
    const sectionMatch = trimmed.match(/^(\w+):\s*$/);
    if (sectionMatch) {
      if (currentSection && Object.keys(currentValues).length > 0) {
        result[currentSection] = currentValues;
      }
      currentSection = sectionMatch[1];
      currentValues = {};
      continue;
    }

    // Check for key: value
    const kvMatch = trimmed.match(/^(\w+):\s*(\S+)\s*$/);
    if (kvMatch && currentSection) {
      const key = kvMatch[1];
      const value = kvMatch[2];

      // Try to parse as number
      const numValue = Number(value);
      currentValues[key] = isNaN(numValue) ? value : numValue;
    }
  }

  // Save last section
  if (currentSection && Object.keys(currentValues).length > 0) {
    result[currentSection] = currentValues;
  }

  return result;
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
