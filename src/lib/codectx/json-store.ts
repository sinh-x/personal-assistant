/**
 * JSON store - persists the code graph to JSON files.
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";
import type { CodeGraph } from "./types.js";

/** Default data directory for code context */
const DEFAULT_DATA_DIR = resolve(
  homedir(),
  ".local/share/personal-assistant/code-context"
);

/**
 * Get the graph file path for a repository.
 */
export function getGraphPath(repo: string, dataDir?: string): string {
  const base = dataDir || DEFAULT_DATA_DIR;
  // Use repo name as directory name
  const repoName = repo.split("/").pop() || repo;
  return resolve(base, repoName, "graph.json");
}

/**
 * Ensure the directory for a graph file exists.
 */
function ensureDir(graphPath: string): void {
  const dir = dirname(graphPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Save a code graph to a JSON file.
 */
export function saveGraph(graph: CodeGraph, dataDir?: string): string {
  const graphPath = getGraphPath(graph.repo, dataDir);
  ensureDir(graphPath);

  const json = JSON.stringify(graph, null, 2);
  writeFileSync(graphPath, json, "utf-8");

  return graphPath;
}

/**
 * Load a code graph from a JSON file.
 */
export function loadGraph(repo: string, dataDir?: string): CodeGraph | null {
  const graphPath = getGraphPath(repo, dataDir);

  if (!existsSync(graphPath)) {
    return null;
  }

  try {
    const content = readFileSync(graphPath, "utf-8");
    return JSON.parse(content) as CodeGraph;
  } catch {
    return null;
  }
}

/**
 * Check if a graph exists for a repository.
 */
export function graphExists(repo: string, dataDir?: string): boolean {
  const graphPath = getGraphPath(repo, dataDir);
  return existsSync(graphPath);
}

/**
 * Delete a graph for a repository.
 */
export function deleteGraph(repo: string, dataDir?: string): boolean {
  const graphPath = getGraphPath(repo, dataDir);

  if (!existsSync(graphPath)) {
    return false;
  }

  try {
    const { unlinkSync } = require("node:fs");
    unlinkSync(graphPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the data directory for code context.
 */
export function getCodeContextDir(dataDir?: string): string {
  return dataDir || DEFAULT_DATA_DIR;
}