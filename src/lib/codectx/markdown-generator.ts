/**
 * Markdown generator - generates human-readable CODEBASE.md summary from the graph.
 */

import type { CodeGraph } from "./types.js";
import { computeStats, getTopExports } from "./graph-builder.js";

/**
 * Generate a markdown summary from a code graph.
 */
export function generateMarkdown(
  graph: CodeGraph,
  opts: { title?: string; includeExports?: boolean } = {}
): string {
  const title = opts.title || "Codebase Overview";
  const stats = computeStats(graph);
  const topExports = getTopExports(graph);

  const lines: string[] = [];

  // Header
  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`> **Generated:** ${graph.generatedAt}`);
  lines.push(`> **Repository:** ${graph.repo}`);
  lines.push("");

  // Summary table
  lines.push("## Summary");
  lines.push("");
  lines.push("| Metric | Count |");
  lines.push("|--------|-------|");
  lines.push(`| Files | ${stats.files} |`);
  lines.push(`| Functions | ${stats.functions} |`);
  lines.push(`| Classes | ${stats.classes} |`);
  lines.push(`| Methods | ${stats.methods} |`);
  lines.push(`| Interfaces | ${stats.interfaces} |`);
  lines.push(`| Types | ${stats.types} |`);
  lines.push(`| Enums | ${stats.enums} |`);
  lines.push("");
  lines.push(`**Total nodes:** ${graph.nodeCount} | **Total edges:** ${graph.edgeCount}`);
  lines.push("");

  // Top-level exports
  if (opts.includeExports !== false && topExports.length > 0) {
    lines.push("## Top-Level Exports");
    lines.push("");
    lines.push("```");
    for (const exp of topExports) {
      lines.push(`- ${exp}`);
    }
    lines.push("```");
    lines.push("");
  }

  // File index
  lines.push("## Files");
  lines.push("");
  const fileNodes = Object.values(graph.nodes).filter((n) => n.type === "file");
  for (const fileNode of fileNodes) {
    const fileName = fileNode.name;
    const exports = fileNode.exports?.length
      ? ` (exports: ${fileNode.exports.join(", ")})`
      : "";
    lines.push(`### ${fileName}${exports}`);
    lines.push("");
    lines.push(`Path: \`${fileNode.file}\``);
    lines.push("");

    // Find declarations in this file
    const declarations = Object.values(graph.nodes).filter(
      (n) => n.file === fileNode.file && n.type !== "file"
    );

    if (declarations.length > 0) {
      lines.push("**Declarations:**");
      lines.push("");

      // Group by type
      const byType = new Map<string, typeof declarations>();
      for (const decl of declarations) {
        const arr = byType.get(decl.type) || [];
        arr.push(decl);
        byType.set(decl.type, arr);
      }

      for (const [type, decls] of byType) {
        lines.push(`**${type}s:**`);
        for (const decl of decls) {
          lines.push(
            `- \`${decl.name}\` (line ${decl.startLine})`
          );
        }
        lines.push("");
      }
    }
  }

  return lines.join("\n");
}

/**
 * Generate a summary string for embedding in other documents.
 */
export function generateSummary(graph: CodeGraph): string {
  const stats = computeStats(graph);
  const topExports = getTopExports(graph).slice(0, 10);

  return [
    `Files: ${stats.files} | Functions: ${stats.functions} | Classes: ${stats.classes} | Interfaces: ${stats.interfaces}`,
    `Top exports: ${topExports.join(", ")}`,
  ].join(" | ");
}
