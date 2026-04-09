/**
 * Graph builder - constructs the code graph from parsed declarations.
 */

import type {
  CodeGraph,
  GraphNode,
  GraphEdge,
  GraphStats,
} from "./types.js";
import { SCHEMA_VERSION } from "./types.js";

/**
 * Create an empty code graph for a repository.
 */
export function createEmptyGraph(repo: string): CodeGraph {
  return {
    schemaVersion: SCHEMA_VERSION,
    repo,
    generatedAt: new Date().toISOString(),
    nodeCount: 0,
    edgeCount: 0,
    nodes: {},
    edges: {},
    fileIndex: {},
  };
}

/**
 * Add a node to the graph.
 */
export function addNode(graph: CodeGraph, node: GraphNode): void {
  graph.nodes[node.id] = node;

  // Update file index
  if (!graph.fileIndex[node.file]) {
    graph.fileIndex[node.file] = [];
  }
  if (!graph.fileIndex[node.file].includes(node.id)) {
    graph.fileIndex[node.file].push(node.id);
  }

  graph.nodeCount = Object.keys(graph.nodes).length;
}

/**
 * Add an edge to the graph.
 */
export function addEdge(graph: CodeGraph, edge: GraphEdge): void {
  graph.edges[edge.id] = edge;
  graph.edgeCount = Object.keys(graph.edges).length;
}

/**
 * Build edges between nodes based on import/usage relationships.
 * This is a simplified version that connects nodes within the same file.
 */
export function buildRelationships(graph: CodeGraph): void {
  const fileNodes: Record<string, GraphNode[]> = {};

  // Group nodes by file
  for (const node of Object.values(graph.nodes)) {
    if (!fileNodes[node.file]) {
      fileNodes[node.file] = [];
    }
    fileNodes[node.file].push(node);
  }

  // For each file, create implicit relationships between exported items
  for (const [file, nodes] of Object.entries(fileNodes)) {
    const exportedNodes = nodes.filter(
      (n) => n.type !== "function" || n.exports?.length
    );

    // Create call edges between functions in the same file
    for (const node of nodes) {
      if (node.type !== "function") continue;

      // Find references to other functions in the same file
      for (const other of nodes) {
        if (other.id === node.id) continue;
        if (other.type !== "function" && other.type !== "method") continue;

        // Check if this function might call the other (heuristic: same file context)
        // In a full implementation, we'd use tree-sitter to find actual call sites
      }
    }
  }
}

/**
 * Merge parse results into the graph.
 */
export function mergeParseResult(
  graph: CodeGraph,
  file: string,
  nodes: GraphNode[],
  edges: GraphEdge[]
): void {
  // Add file node if not exists
  const fileNodeId = `file:${file}`;
  if (!graph.nodes[fileNodeId]) {
    addNode(graph, {
      id: fileNodeId,
      type: "file",
      name: file.split("/").pop() || file,
      file,
      startLine: 1,
      endLine: 1,
      exports: nodes.map((n) => n.name),
      imports: [],
    });
  }

  // Add declaration nodes
  for (const node of nodes) {
    addNode(graph, node);
  }

  // Add edges
  for (const edge of edges) {
    if (graph.nodes[edge.source] && graph.nodes[edge.target]) {
      addEdge(graph, edge);
    }
  }
}

/**
 * Compute statistics for the graph.
 */
export function computeStats(graph: CodeGraph): GraphStats {
  const stats: GraphStats = {
    files: 0,
    functions: 0,
    classes: 0,
    methods: 0,
    interfaces: 0,
    types: 0,
    enums: 0,
    edges: graph.edgeCount,
  };

  const seenFiles = new Set<string>();

  for (const node of Object.values(graph.nodes)) {
    if (node.type === "file") {
      stats.files++;
      seenFiles.add(node.file);
    } else if (node.type === "function") {
      stats.functions++;
    } else if (node.type === "class") {
      stats.classes++;
    } else if (node.type === "method") {
      stats.methods++;
    } else if (node.type === "interface") {
      stats.interfaces++;
    } else if (node.type === "type") {
      stats.types++;
    } else if (node.type === "enum") {
      stats.enums++;
    }
  }

  // Count unique files (nodes that have a file path but aren't file nodes)
  const allFiles = new Set<string>();
  for (const node of Object.values(graph.nodes)) {
    if (node.type !== "file" && node.file) {
      allFiles.add(node.file);
    }
  }
  stats.files = allFiles.size;

  return stats;
}

/**
 * Get top-level exports from the graph (useful for primer injection).
 */
export function getTopExports(graph: CodeGraph): string[] {
  const exports: string[] = [];

  for (const node of Object.values(graph.nodes)) {
    if (
      node.type === "function" ||
      node.type === "class" ||
      node.type === "interface"
    ) {
      exports.push(node.name);
    }
  }

  return exports.slice(0, 20); // Limit to top 20
}

/**
 * Find a node by name in the graph.
 */
export function findNodeByName(
  graph: CodeGraph,
  name: string
): GraphNode | undefined {
  return Object.values(graph.nodes).find((n) => n.name === name);
}

/**
 * Find nodes by file in the graph.
 */
export function findNodesByFile(
  graph: CodeGraph,
  file: string
): GraphNode[] {
  const nodeIds = graph.fileIndex[file] || [];
  return nodeIds.map((id) => graph.nodes[id]).filter(Boolean);
}

/**
 * Find callers of a function in the graph.
 */
export function findCallers(
  graph: CodeGraph,
  functionName: string
): GraphNode[] {
  const edges = Object.values(graph.edges).filter(
    (e) => e.type === "calls" && e.target.endsWith(`:${functionName}:function`)
  );
  return edges.map((e) => graph.nodes[e.source]).filter(Boolean);
}