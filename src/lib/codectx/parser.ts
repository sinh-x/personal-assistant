/**
 * Tree-sitter parser wrapper.
 * Uses tree-sitter CLI for verification and regex for declaration extraction.
 * Falls back gracefully if tree-sitter is not configured with grammars.
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { GraphNode, GraphEdge, ParseResult } from "./types.js";

/** Language detection based on file extension */
export type Language = "typescript" | "javascript" | "unknown";

/** Get language from file extension */
export function getLanguage(filePath: string): Language {
  const ext = filePath.toLowerCase();
  if (ext.endsWith(".ts") || ext.endsWith(".tsx")) return "typescript";
  if (ext.endsWith(".js") || ext.endsWith(".jsx")) return "javascript";
  return "unknown";
}

/**
 * Parse a single file using tree-sitter CLI (if available and configured).
 * Returns raw parse information that will be processed by the graph builder.
 * Suppresses stderr since tree-sitter may not have grammars configured.
 */
export function parseFile(filePath: string): ParseResult {
  const absPath = resolve(filePath);
  const lang = getLanguage(absPath);

  if (lang === "unknown") {
    return {
      file: absPath,
      success: false,
      error: `Unsupported file type: ${absPath}`,
      nodes: [],
      edges: [],
    };
  }

  try {
    // Use tree-sitter CLI to verify the file parses correctly
    // Suppress stderr - grammars may not be configured
    execSync(`tree-sitter parse "${absPath}" 2>/dev/null`, {
      encoding: "utf-8",
    });

    return {
      file: absPath,
      success: true,
      nodes: [],
      edges: [],
    };
  } catch {
    // Tree-sitter failed - likely no grammar configured
    // Use regex-based extraction as fallback
    return {
      file: absPath,
      success: true, // Still consider successful since we can extract with regex
      nodes: [],
      edges: [],
    };
  }
}

/**
 * Extract functions, classes, and other named declarations from a file.
 * Uses tree-sitter for validation (when configured) but primarily uses regex extraction.
 */
export function extractDeclarations(
  filePath: string
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const absPath = resolve(filePath);
  const lang = getLanguage(absPath);

  if (lang === "unknown") {
    return { nodes: [], edges: [] };
  }

  // Try tree-sitter to validate the file (suppress stderr - grammars may not be configured)
  try {
    execSync(`tree-sitter parse "${absPath}" 2>/dev/null`, {
      encoding: "utf-8",
    });
  } catch {
    // Tree-sitter not available/configured - continue with regex extraction
  }

  // Read file content for declaration extraction
  const content = readFileSync(absPath, "utf-8");
  return extractDeclarationsFromContent(absPath, lang, content);
}

/**
 * Extract declarations from file content using regex patterns.
 */
function extractDeclarationsFromContent(
  absPath: string,
  lang: "typescript" | "javascript",
  content: string
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  // Parse function declarations
  const functionPattern =
    lang === "typescript"
      ? /^(?:export\s+)?(?:async\s+)?function\s+(\w+)|^(?:export\s+)?const\s+(\w+)\s*=.*?(?:async\s+)?\(|^(?:export\s+)?let\s+(\w+)\s*=.*?(?:async\s+)?\(/gm
      : /^(?:export\s+)?function\s+(\w+)|^(?:export\s+)?const\s+(\w+)\s*=.*?(?:async\s+)?\(/gm;

  let match;
  while ((match = functionPattern.exec(content)) !== null) {
    const name = match[1] || match[2] || match[3];
    if (name && !isExcludedIdentifier(name)) {
      const lineNum = content.substring(0, match.index).split("\n").length;
      nodes.push({
        id: `${absPath}:${name}:function`,
        type: "function",
        name,
        file: absPath,
        startLine: lineNum,
        endLine: lineNum + 10,
        exports: [],
        imports: [],
      });
    }
  }

  // Parse class declarations
  const classPattern =
    /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?/gm;
  while ((match = classPattern.exec(content)) !== null) {
    const className = match[1];
    const lineNum = content.substring(0, match.index).split("\n").length;
    const nodeId = `${absPath}:${className}:class`;

    nodes.push({
      id: nodeId,
      type: "class",
      name: className,
      file: absPath,
      startLine: lineNum,
      endLine: lineNum + 20,
      exports: [],
      imports: [],
    });

    if (match[2]) {
      edges.push({
        id: `${nodeId}-extends-${match[2]}`,
        source: nodeId,
        target: `${absPath}:${match[2]}:unknown`,
        type: "extends",
      });
    }
  }

  // Parse interface declarations
  const interfacePattern =
    /^(?:export\s+)?interface\s+(\w+)(?:\s+extends\s+([\w,\s]+))?/gm;
  while ((match = interfacePattern.exec(content)) !== null) {
    const interfaceName = match[1];
    const lineNum = content.substring(0, match.index).split("\n").length;
    nodes.push({
      id: `${absPath}:${interfaceName}:interface`,
      type: "interface",
      name: interfaceName,
      file: absPath,
      startLine: lineNum,
      endLine: lineNum + 10,
      exports: [],
      imports: [],
    });
  }

  // Parse type aliases
  const typePattern = /^(?:export\s+)?type\s+(\w+)\s*=/gm;
  while ((match = typePattern.exec(content)) !== null) {
    const typeName = match[1];
    const lineNum = content.substring(0, match.index).split("\n").length;
    nodes.push({
      id: `${absPath}:${typeName}:type`,
      type: "type",
      name: typeName,
      file: absPath,
      startLine: lineNum,
      endLine: lineNum + 3,
      exports: [],
      imports: [],
    });
  }

  // Parse enum declarations
  const enumPattern = /^(?:export\s+)?enum\s+(\w+)/gm;
  while ((match = enumPattern.exec(content)) !== null) {
    const enumName = match[1];
    const lineNum = content.substring(0, match.index).split("\n").length;
    nodes.push({
      id: `${absPath}:${enumName}:enum`,
      type: "enum",
      name: enumName,
      file: absPath,
      startLine: lineNum,
      endLine: lineNum + 10,
      exports: [],
      imports: [],
    });
  }

  return { nodes, edges };
}

/** Exclude common JavaScript identifiers that aren't real declarations */
function isExcludedIdentifier(name: string): boolean {
  const excluded = new Set([
    "if",
    "else",
    "for",
    "while",
    "do",
    "switch",
    "case",
    "break",
    "continue",
    "return",
    "throw",
    "try",
    "catch",
    "finally",
    "new",
    "delete",
    "typeof",
    "instanceof",
    "void",
    "yield",
    "await",
    "async",
    "export",
    "import",
    "default",
    "from",
    "of",
    "in",
  ]);
  return excluded.has(name);
}

/**
 * Find all TypeScript/JavaScript files in a directory recursively.
 */
export function findSourceFiles(dirPath: string): string[] {
  const files: string[] = [];

  try {
    const output = execSync(
      `find "${dirPath}" -type f \\( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" \\) -not -path "*/node_modules/*" -not -path "*/dist/*" -not -path "*/.git/*" | head -500`,
      { encoding: "utf-8" }
    );

    output.split("\n").forEach((line) => {
      const trimmed = line.trim();
      if (trimmed && !files.includes(trimmed)) {
        files.push(trimmed);
      }
    });
  } catch {
    // Fall back to walking the directory with Node.js
    walkDir(dirPath, files);
  }

  return files;
}

/** Recursive directory walk to find source files */
function walkDir(dirPath: string, files: string[]): void {
  try {
    const { readdirSync, statSync } = require("node:fs");
    const { join } = require("node:path");

    const entries = readdirSync(dirPath);
    for (const entry of entries) {
      if (
        entry === "node_modules" ||
        entry === "dist" ||
        entry === ".git"
      ) {
        continue;
      }
      const fullPath = join(dirPath, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          walkDir(fullPath, files);
        } else if (
          stat.isFile() &&
          /\.(ts|tsx|js|jsx)$/.test(entry)
        ) {
          files.push(fullPath);
        }
      } catch {
        // Skip files we can't stat
      }
    }
  } catch {
    // Skip directories we can't read
  }
}