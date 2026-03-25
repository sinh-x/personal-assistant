import type { Runtime } from "./types.js";

const VALID_CLAUDE_MODELS = new Set(["haiku", "sonnet", "opus"]);
const PROVIDER_MODEL_RE = /^[a-z0-9_-]+\/[a-zA-Z0-9._-]+$/;

export interface RuntimeOpts {
  model?: string;
}

/** Runtime abstraction for agent invocation */
export interface AgentRuntime {
  readonly name: Runtime;
  /** Build command for interactive/foreground/direct modes */
  buildCommand(prompt: string, opts: RuntimeOpts): string;
  /** Build command for background (--print) mode. May throw for unsupported runtimes. */
  buildBackgroundCommand(prompt: string, opts: RuntimeOpts): string;
  /** Validate that a model string is acceptable for this runtime */
  validateModel(model: string): boolean;
}

export class ClaudeRuntime implements AgentRuntime {
  readonly name = "claude" as const;

  buildCommand(prompt: string, opts: RuntimeOpts): string {
    const modelFlag = opts.model ? `--model ${opts.model} ` : "";
    return `claude ${modelFlag}--dangerously-skip-permissions ${JSON.stringify(prompt)}`.trim();
  }

  buildBackgroundCommand(prompt: string, opts: RuntimeOpts): string {
    const modelFlag = opts.model ? `--model ${opts.model} ` : "";
    const escaped = prompt.replace(/'/g, "'\\''");
    return `claude ${modelFlag}--dangerously-skip-permissions --print '${escaped}'`;
  }

  validateModel(model: string): boolean {
    return VALID_CLAUDE_MODELS.has(model);
  }
}

export class OpencodeRuntime implements AgentRuntime {
  readonly name = "opencode" as const;

  buildCommand(prompt: string, opts: RuntimeOpts): string {
    const modelFlag = opts.model ? `-m ${opts.model} ` : "";
    return `opencode run ${modelFlag}${JSON.stringify(prompt)}`.trim();
  }

  buildBackgroundCommand(_prompt: string, _opts: RuntimeOpts): string {
    throw new Error("Background mode is not supported for opencode runtime (Phase 4 — deferred)");
  }

  validateModel(model: string): boolean {
    return PROVIDER_MODEL_RE.test(model);
  }
}

/** Resolve runtime from CLI flag > config value > default "claude" */
export function resolveRuntime(
  configRuntime: string | undefined,
  cliRuntime: string | undefined
): AgentRuntime {
  const runtime = cliRuntime ?? configRuntime ?? "claude";
  if (runtime === "opencode") return new OpencodeRuntime();
  if (runtime === "claude") return new ClaudeRuntime();
  console.warn(`Warning: unknown runtime "${runtime}" — falling back to claude`);
  return new ClaudeRuntime();
}
