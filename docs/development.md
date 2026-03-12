# Development Guide

## Setup

Prerequisites: Nix with flakes enabled.

```bash
cd /home/sinh/git-repos/sinh-x/tools/personal-assistant

# direnv auto-activates the devshell (pnpm, nodejs_22):
direnv allow

# Or manually:
nix develop
```

## Build & Test

```bash
pnpm install       # Install dependencies
pnpm build         # Compile with tsup → dist/cli.mjs
pnpm typecheck     # Run tsc --noEmit
```

Run locally without Nix rebuild:

```bash
node dist/cli.mjs teams
node dist/cli.mjs deploy maintenance --dry-run
node dist/cli.mjs status
```

## Adding a New Command

1. Create `src/commands/my-command.ts`:

```typescript
export function myCommand(arg: string): void {
  // Implementation
  console.log(`Running my-command with ${arg}`);
}
```

2. Register in `src/cli.ts`:

```typescript
import { myCommand } from "./commands/my-command.js";

program
  .command("my-command")
  .description("What it does")
  .argument("<arg>", "Argument description")
  .action((arg: string) => {
    myCommand(arg);
  });
```

3. Build and test:

```bash
pnpm build
node dist/cli.mjs my-command test
```

## Code Conventions

- **ESM** — `"type": "module"` in package.json, `.js` extensions in imports
- **No `any` types** — type everything strictly
- **Types in `types.ts`** — shared interfaces live in `src/lib/types.ts`
- **One file per command** — each subcommand in `src/commands/`
- **Lib for shared logic** — reusable code in `src/lib/`

## Nix Packaging

The `flake.nix` builds with `pnpmConfigHook`:

1. `fetchPnpmDeps` downloads dependencies (hash in `pnpmDeps`)
2. `pnpm build` compiles to `dist/cli.mjs`
3. `makeWrapper` creates `pa` binary with `PA_HOME` set and runtime deps on `PATH`

### Updating the pnpm hash

After changing `package.json` or `pnpm-lock.yaml`:

```bash
# Get the new hash (it will fail with the expected hash):
nix build .#personal-assistant 2>&1 | grep 'got:'
# Update the hash in flake.nix
```

### Full rebuild:

```bash
nix build .#personal-assistant
result/bin/pa help
```

## Project Layout

```
src/cli.ts           → Commander.js entry point
src/commands/*.ts    → Subcommand implementations
src/lib/types.ts     → All shared TypeScript interfaces
src/lib/config.ts    → Config loading (env vars + config file)
src/lib/paths.ts     → Path resolution helpers
src/lib/registry.ts  → JSONL registry read/write
src/lib/yaml-parser.ts → Team YAML parsing
src/lib/primer.ts    → Primer document generation
src/utils/process.ts → Detached process spawning
```

## Debugging

- **Primer issues**: `pa deploy <team> --dry-run` prints the full primer
- **Deployment issues**: Check `~/.local/share/personal-assistant/logs/<team>-<id>.log`
- **Registry issues**: `cat ~/Documents/ai-usage/deployments/registry.jsonl | jq .`
- **Timer issues**: `systemctl --user status pa-<name>.timer`
