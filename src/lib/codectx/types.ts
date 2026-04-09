/**
 * Type definitions for CodeContext graph structure.
 * The graph represents code structure as nodes (functions, classes, files) and
 * edges (import/call relationships).
 */

/** Schema version for the graph JSON format */
export const SCHEMA_VERSION = "1.0.0";

/** A node in the code graph */
export interface GraphNode {
  id: string;
  type: "file" | "function" | "class" | "method" | "interface" | "type" | "enum";
  name: string;
  file: string;
  startLine: number;
  endLine: number;
  exports?: string[];
  imports?: string[];
  children?: string[];
  metadata?: Record<string, unknown>;
}

/** An edge in the code graph representing a relationship */
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: "imports" | "calls" | "extends" | "implements" | "member-of";
}

/** The complete code graph */
export interface CodeGraph {
  schemaVersion: string;
  repo: string;
  generatedAt: string;
  nodeCount: number;
  edgeCount: number;
  nodes: Record<string, GraphNode>;
  edges: Record<string, GraphEdge>;
  fileIndex: Record<string, string[]>;
}

/** Result of parsing a single file */
export interface ParseResult {
  file: string;
  success: boolean;
  error?: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Statistics about a code graph */
export interface GraphStats {
  files: number;
  functions: number;
  classes: number;
  methods: number;
  interfaces: number;
  types: number;
  enums: number;
  edges: number;
}