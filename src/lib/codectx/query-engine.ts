/**
 * Query engine - executes queries against the code graph.
 */

import type { CodeGraph, GraphNode, GraphStats } from "./types.js";
import { computeStats, getTopExports, findCallers } from "./graph-builder.js";

/** Query result types */
export interface FileQueryResult {
  type: "file";
  file: string;
  declarations: Array<{
    name: string;
    declarationType: string;
    startLine: number;
    endLine: number;
    signature?: string;
  }>;
}

export interface FunctionQueryResult {
  type: "function";
  name: string;
  file: string;
  startLine: number;
  endLine: number;
  signature?: string;
  callers: Array<{
    name: string;
    file: string;
    line: number;
  }>;
}

export interface ClassQueryResult {
  type: "class";
  name: string;
  file: string;
  startLine: number;
  endLine: number;
  methods: Array<{
    name: string;
    line: number;
  }>;
}

export interface ExportsQueryResult {
  type: "exports";
  exports: string[];
  byFile: Record<string, string[]>;
}

export type QueryResult =
  | FileQueryResult
  | FunctionQueryResult
  | ClassQueryResult
  | ExportsQueryResult;

/**
 * Query file declarations.
 */
export function queryFile(
  graph: CodeGraph,
  filePath: string
): FileQueryResult | null {
  // Find the file node or any nodes matching the path
  const matchingNodes = Object.values(graph.nodes).filter(
    (n) => n.file.includes(filePath) || n.file.endsWith(filePath)
  );

  if (matchingNodes.length === 0) {
    return null;
  }

  // Get the actual file path from matched nodes
  const fileNode = matchingNodes.find((n) => n.type === "file");
  const actualFilePath = fileNode?.file || matchingNodes[0].file;

  // Get all declarations in this file
  const declarations = matchingNodes
    .filter((n) => n.type !== "file")
    .map((n) => ({
      name: n.name,
      declarationType: n.type,
      startLine: n.startLine,
      endLine: n.endLine,
      signature: extractSignature(n),
    }));

  return {
    type: "file",
    file: actualFilePath,
    declarations,
  };
}

/**
 * Query function by name.
 */
export function queryFunction(
  graph: CodeGraph,
  functionName: string
): FunctionQueryResult | null {
  const node = Object.values(graph.nodes).find(
    (n) => n.type === "function" && n.name === functionName
  );

  if (!node) {
    return null;
  }

  // Find callers
  const callerNodes = findCallers(graph, functionName);
  const callers = callerNodes.map((n) => ({
    name: n.name,
    file: n.file,
    line: n.startLine,
  }));

  return {
    type: "function",
    name: node.name,
    file: node.file,
    startLine: node.startLine,
    endLine: node.endLine,
    signature: extractSignature(node),
    callers,
  };
}

/**
 * Query class by name.
 */
export function queryClass(
  graph: CodeGraph,
  className: string
): ClassQueryResult | null {
  const node = Object.values(graph.nodes).find(
    (n) => n.type === "class" && n.name === className
  );

  if (!node) {
    return null;
  }

  // Find methods (nodes that have this class as parent or are in same file with class prefix)
  const methods = Object.values(graph.nodes).filter(
    (n) =>
      n.type === "method" ||
      (n.type === "function" &&
        n.file === node.file &&
        n.startLine > node.startLine &&
        n.startLine < node.endLine)
  );

  return {
    type: "class",
    name: node.name,
    file: node.file,
    startLine: node.startLine,
    endLine: node.endLine,
    methods: methods.map((m) => ({
      name: m.name,
      line: m.startLine,
    })),
  };
}

/**
 * Query all top-level exports.
 */
export function queryExports(graph: CodeGraph): ExportsQueryResult {
  const topExports = getTopExports(graph);

  // Group exports by file
  const byFile: Record<string, string[]> = {};
  for (const node of Object.values(graph.nodes)) {
    if (
      node.type === "function" ||
      node.type === "class" ||
      node.type === "interface"
    ) {
      const fileName = node.file.split("/").pop() || node.file;
      if (!byFile[fileName]) {
        byFile[fileName] = [];
      }
      byFile[fileName].push(node.name);
    }
  }

  return {
    type: "exports",
    exports: topExports,
    byFile,
  };
}

/**
 * Extract a signature string from a node's metadata or construct one.
 */
function extractSignature(node: GraphNode): string | undefined {
  // If we have signature metadata, use it
  if (node.metadata?.signature) {
    return String(node.metadata.signature);
  }

  // Construct a basic signature based on node type
  switch (node.type) {
    case "function":
      return `function ${node.name}(...)`;
    case "method":
      return `method ${node.name}(...)`;
    case "class":
      return `class ${node.name}`;
    case "interface":
      return `interface ${node.name}`;
    case "type":
      return `type ${node.name}`;
    case "enum":
      return `enum ${node.name}`;
    default:
      return undefined;
  }
}

/**
 * Format a FileQueryResult for display.
 */
export function formatFileResult(result: FileQueryResult): string {
  const lines: string[] = [];
  lines.push(`File: ${result.file}`);
  lines.push(`Declarations (${result.declarations.length}):`);
  lines.push("");

  // Group by type
  const byType = new Map<string, typeof result.declarations>();
  for (const decl of result.declarations) {
    const arr = byType.get(decl.declarationType) || [];
    arr.push(decl);
    byType.set(decl.declarationType, arr);
  }

  for (const [type, decls] of byType) {
    lines.push(`**${type}s:**`);
    for (const decl of decls) {
      const sig = decl.signature ? ` — ${decl.signature}` : "";
      lines.push(`- \`${decl.name}\` (line ${decl.startLine})${sig}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Format a FunctionQueryResult for display.
 */
export function formatFunctionResult(result: FunctionQueryResult): string {
  const lines: string[] = [];
  lines.push(`Function: ${result.name}`);
  lines.push(`  File: ${result.file}`);
  lines.push(`  Line: ${result.startLine}`);
  if (result.signature) {
    lines.push(`  Signature: ${result.signature}`);
  }
  if (result.callers.length > 0) {
    lines.push(`  Callers (${result.callers.length}):`);
    for (const caller of result.callers) {
      lines.push(
        `    - ${caller.name} (${caller.file}:${caller.line})`
      );
    }
  } else {
    lines.push(`  Callers: none`);
  }
  return lines.join("\n");
}

/**
 * Format a ClassQueryResult for display.
 */
export function formatClassResult(result: ClassQueryResult): string {
  const lines: string[] = [];
  lines.push(`Class: ${result.name}`);
  lines.push(`  File: ${result.file}`);
  lines.push(`  Line: ${result.startLine}`);
  if (result.methods.length > 0) {
    lines.push(`  Methods (${result.methods.length}):`);
    for (const method of result.methods) {
      lines.push(`    - ${method.name} (line ${method.line})`);
    }
  }
  return lines.join("\n");
}

/**
 * Format an ExportsQueryResult for display.
 */
export function formatExportsResult(result: ExportsQueryResult): string {
  const lines: string[] = [];
  lines.push(`Top exports (${result.exports.length} total):`);
  lines.push("");
  for (const exp of result.exports) {
    lines.push(`  ${exp}`);
  }
  return lines.join("\n");
}
