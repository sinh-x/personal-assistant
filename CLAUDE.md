# personal-assistant — Project Guidelines for Claude

## Version Management

**Single source of truth: `package.json`**

`flake.nix` reads the version dynamically via:
```nix
version = (builtins.fromJSON (builtins.readFile ./package.json)).version;
```

Never manually edit the version in `flake.nix`. Only update `package.json`.

### Bumping the version

```bash
pnpm bump:patch   # 0.1.3 → 0.1.4
pnpm bump:minor   # 0.1.3 → 0.2.0
pnpm bump:major   # 0.1.3 → 1.0.0
```

Or directly:
```bash
bash scripts/dev/version_bump.sh [patch|minor|major]
```

The script: reads current version from `package.json`, computes new version, updates `package.json`, runs `pnpm build`, commits, and pushes to main.

## Team Name Convention

Team names come from the `name:` field in the team YAML, not the filename.
When `daily.ts` writes a temp YAML file (e.g. `daily-end-<timestamp>.yaml`), `deploy.ts`
uses `teamConfig.name` (`"daily"`) as the canonical name — ensuring all daily modes
share one team workspace at `~/Documents/ai-usage/agent-teams/daily/`.
