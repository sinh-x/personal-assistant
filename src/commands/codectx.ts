/**
 * CodeContext CLI command - pa codectx
 * Analyzes code structure using tree-sitter and generates a JSON graph.
 */

import { Command } from "commander";
import { resolve, dirname } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import {
  createEmptyGraph,
  mergeParseResult,
  computeStats,
  getTopExports,
} from "../lib/codectx/graph-builder.js";
import {
  extractDeclarations,
  findSourceFiles,
  parseFile,
} from "../lib/codectx/parser.js";
import {
  saveGraph,
  loadGraph,
  graphExists,
  getCodeContextDir,
} from "../lib/codectx/json-store.js";
import { generateMarkdown } from "../lib/codectx/markdown-generator.js";
import {
  queryFile,
  queryFunction,
  queryClass,
  queryExports,
  formatFileResult,
  formatFunctionResult,
  formatClassResult,
  formatExportsResult,
} from "../lib/codectx/query-engine.js";
import type { CodeGraph, GraphStats } from "../lib/codectx/types.js";

/**
 * Analyze a repository and generate a code graph.
 */
async function analyzeRepo(
  repoPath: string,
  options: { dataDir?: string; verbose?: boolean }
): Promise<{ graph: CodeGraph; stats: GraphStats; duration: number }> {
  const absRepoPath = resolve(repoPath);
  const startTime = Date.now();

  if (options.verbose) {
    console.error(`Analyzing repository: ${absRepoPath}`);
  }

  // Find all source files
  const files = findSourceFiles(absRepoPath);
  if (options.verbose) {
    console.error(`Found ${files.length} source files`);
  }

  // Create empty graph
  const graph = createEmptyGraph(absRepoPath);

  // Process each file
  let processed = 0;
  let errors = 0;

  for (const file of files) {
    try {
      // First verify the file parses
      const parseResult = parseFile(file);
      if (!parseResult.success) {
        if (options.verbose) {
          console.error(`Skipping ${file}: ${parseResult.error}`);
        }
        errors++;
        continue;
      }

      // Extract declarations
      const { nodes, edges } = extractDeclarations(file);
      mergeParseResult(graph, file, nodes, edges);
      processed++;
    } catch (err) {
      if (options.verbose) {
        console.error(`Error processing ${file}: ${err}`);
      }
      errors++;
    }
  }

  const duration = Date.now() - startTime;
  const stats = computeStats(graph);

  if (options.verbose) {
    console.error(
      `Processed ${processed} files, ${errors} errors, ${duration}ms`
    );
  }

  return { graph, stats, duration };
}

/**
 * Format statistics for display.
 */
function formatStats(stats: GraphStats, duration: number): string {
  return [
    `Files: ${stats.files}`,
    `Functions: ${stats.functions}`,
    `Classes: ${stats.classes}`,
    `Interfaces: ${stats.interfaces}`,
    `Types: ${stats.types}`,
    `Enums: ${stats.enums}`,
    `Edges: ${stats.edges}`,
    `Parse time: ${duration}ms`,
  ].join(" | ");
}

/**
 * Create the codectx command.
 */
export function createCodeCtxCommand(): Command {
  const cmd = new Command("codectx");

  cmd.description(
    "CodeContext - analyze code structure and generate a queryable graph"
  );

  // Analyze subcommand
  cmd
    .command("analyze")
    .description("Analyze a repository and generate a code graph")
    .argument(
      "[repo]",
      "Repository path (defaults to current directory)"
    )
    .option(
      "--data-dir <path>",
      "Override data directory for graph storage"
    )
    .option("-v, --verbose", "Verbose output")
    .option("--markdown", "Also generate markdown summary file")
    .action(async (repo: string | undefined, opts: { dataDir?: string; verbose?: boolean; markdown?: boolean }) => {
      const repoPath = repo || resolve(".");
      const dataDir = opts.dataDir || getCodeContextDir();

      try {
        const { graph, stats, duration } = await analyzeRepo(repoPath, {
          dataDir,
          verbose: opts.verbose,
        });

        // Save the graph
        const graphPath = saveGraph(graph, dataDir);

        // Optionally generate markdown summary
        if (opts.markdown) {
          const markdown = generateMarkdown(graph, {
            title: `Codebase Overview: ${graph.repo.split("/").pop()}`,
          });
          const markdownPath = graphPath.replace("/graph.json", "/CODEBASE.md");
          const dir = dirname(markdownPath);
          mkdirSync(dir, { recursive: true });
          writeFileSync(markdownPath, markdown, "utf-8");
          console.log(`Markdown saved to: ${markdownPath}`);
        }

        // Output summary
        console.log(`CodeContext analysis complete`);
        console.log(formatStats(stats, duration));
        console.log(`Graph saved to: ${graphPath}`);

        // Show top exports
        const topExports = getTopExports(graph);
        if (topExports.length > 0) {
          console.log(`Top exports: ${topExports.slice(0, 10).join(", ")}`);
        }
      } catch (err) {
        console.error(`Analysis failed: ${err}`);
        process.exit(1);
      }
    });

  // Query subcommand
  cmd
    .command("query")
    .description("Query the code graph for a repository")
    .argument("<type>", "Query type: file, fn, class, exports")
    .argument("<value>", "Query value (file path, function name, etc.)")
    .argument("[repo]", "Repository path (defaults to current directory)")
    .option("-v, --verbose", "Verbose output")
    .action(
      async (
        type: string,
        value: string,
        repo: string | undefined
      ) => {
        const repoPath = repo || resolve(".");
        const repoName = repoPath.split("/").pop() || repoPath;

        try {
          const graph = loadGraph(repoName);
          if (!graph) {
            console.error(`No graph found for ${repoName}. Run 'pa codectx analyze' first.`);
            process.exit(1);
          }

          switch (type) {
            case "file": {
              const result = queryFile(graph, value);
              if (!result) {
                console.log(`No declarations found matching: ${value}`);
              } else {
                console.log(formatFileResult(result));
              }
              break;
            }
            case "fn":
            case "function": {
              const result = queryFunction(graph, value);
              if (!result) {
                console.log(`Function not found: ${value}`);
              } else {
                console.log(formatFunctionResult(result));
              }
              break;
            }
            case "class": {
              const result = queryClass(graph, value);
              if (!result) {
                console.log(`Class not found: ${value}`);
              } else {
                console.log(formatClassResult(result));
              }
              break;
            }
            case "exports": {
              const result = queryExports(graph);
              console.log(formatExportsResult(result));
              break;
            }
            default:
              console.error(`Unknown query type: ${type}`);
              process.exit(1);
          }
        } catch (err) {
          console.error(`Query failed: ${err}`);
          process.exit(1);
        }
      }
    );

  // Refresh subcommand
  cmd
    .command("refresh")
    .description("Regenerate the code graph for a repository")
    .argument(
      "[repo]",
      "Repository path (defaults to current directory)"
    )
    .option(
      "--data-dir <path>",
      "Override data directory for graph storage"
    )
    .option("-v, --verbose", "Verbose output")
    .action(
      async (
        repo: string | undefined,
        opts: { dataDir?: string; verbose?: boolean }
      ) => {
        const repoPath = repo || resolve(".");
        const dataDir = opts.dataDir || getCodeContextDir();

        if (opts.verbose) {
          console.error(`Refreshing code graph for: ${repoPath}`);
        }

        try {
          const { graph, stats, duration } = await analyzeRepo(repoPath, {
            dataDir,
            verbose: opts.verbose,
          });

          const graphPath = saveGraph(graph, dataDir);

          console.log(`CodeContext refresh complete`);
          console.log(formatStats(stats, duration));
          console.log(`Graph saved to: ${graphPath}`);
        } catch (err) {
          console.error(`Refresh failed: ${err}`);
          process.exit(1);
        }
      }
    );

  // Status subcommand
  cmd
    .command("status")
    .description("Show status of code graphs")
    .argument("[repo]", "Repository path (defaults to current directory)")
    .action((repo: string | undefined) => {
      const repoPath = repo || resolve(".");
      const repoName = repoPath.split("/").pop() || repoPath;

      if (graphExists(repoName)) {
        const graph = loadGraph(repoName);
        if (graph) {
          console.log(`Graph exists for: ${repoName}`);
          console.log(`  Generated: ${graph.generatedAt}`);
          console.log(`  Schema version: ${graph.schemaVersion}`);
          console.log(`  Nodes: ${graph.nodeCount}`);
          console.log(`  Edges: ${graph.edgeCount}`);
        }
      } else {
        console.log(`No graph found for: ${repoName}`);
        console.log(`Run 'pa codectx analyze' to create one.`);
      }
    });

  return cmd;
}