# Skill: Repo Scan — Generate Per-Repo Codebase Summaries

You are the maintenance mechanic in repo-scan mode. Generate or refresh the cached codebase summary for a single repository.

## Output Paths

- **JSON**: `~/Documents/ai-usage/knowledge-base/repo-context/<slug>.json`
- **Markdown**: `~/Documents/ai-usage/knowledge-base/repo-context/<slug>.md`

Where `<slug>` is the repo key (e.g., `pa`, `avodah`).

## JSON Schema

```json
{
  "gitHead": "<current git HEAD>",
  "generatedAt": "<ISO 8601 timestamp>",
  "repoKey": "<slug>",
  "repoPath": "<absolute path>",
  "fileTree": ["<key paths relative to repo root>"],
  "dependencies": { "<package-name>": "<version>" },
  "scripts": { "<script-name>": "<command>" },
  "recentCommits": ["<hash> <message>"],
  "languageFramework": "<detected stack>",
  "keyPatterns": ["<architectural pattern or convention>"]
}
```

## Cache Invalidation

Before any work, check if the cache is current:

```bash
CURRENT_HEAD=$(git -C <repo_path> rev-parse HEAD)
```

Read `~/Documents/ai-usage/knowledge-base/repo-context/<slug>.json`. If `gitHead` matches `CURRENT_HEAD`: **skip regeneration and exit** with a log note "Cache hit — no regeneration needed."

## Step-by-Step Process

### Step 1 — Gather raw data

```bash
# Git HEAD
git -C <repo_path> rev-parse HEAD

# File tree (exclude build artifacts)
find <repo_path> -maxdepth 3 \
  -not -path '*/node_modules/*' \
  -not -path '*/.git/*' \
  -not -path '*/dist/*' \
  -not -path '*/.dart_tool/*' \
  | sort | head -200

# Recent commits (last 20)
git -C <repo_path> log --oneline -20

# Package manifest (Node/Dart/Python)
cat <repo_path>/package.json 2>/dev/null
cat <repo_path>/pubspec.yaml 2>/dev/null
cat <repo_path>/pyproject.toml 2>/dev/null

# README (first 80 lines)
head -80 <repo_path>/README.md 2>/dev/null
```

### Step 2 — Detect language/framework

From the file tree and manifest: identify primary language, framework, and build tools.

Examples: `TypeScript/Node.js/pnpm`, `Dart/Flutter`, `Python/FastAPI`.

### Step 3 — Identify key patterns

Read 3-5 key source files (entry points, key abstractions, config files) to identify:
- Directory structure and purpose of key dirs
- Naming conventions
- Important design patterns or abstractions

**Haiku budget:** lightweight analysis only — < 10s of reading per section. Focus on structure, not exhaustive detail.

### Step 4 — Build JSON

Construct the JSON following the schema above:

- `fileTree`: ~30-50 key paths relative to repo root. Omit `node_modules`, `.git`, `dist`.
- `dependencies`: from `package.json` `dependencies` + `devDependencies`, or equivalent. Omit lock files.
- `scripts`: from `package.json` `scripts`, or equivalent. For repos without a manifest, use `{}`.
- `recentCommits`: last 10-20 commits as `"<short-hash> <message>"` strings.
- `keyPatterns`: 3-7 concise observations about architecture or conventions.

### Step 5 — Write JSON

```bash
mkdir -p ~/Documents/ai-usage/knowledge-base/repo-context/
```

Use the Write tool to save `<slug>.json`.

### Step 6 — Render Markdown

Generate a summary derived from the JSON (< 100 lines):

```markdown
# Codebase Summary: <repoKey>

> **Generated:** <generatedAt> | **Commit:** <gitHead first 8 chars>

## Stack

<languageFramework>

## Key Files & Directories

<fileTree as concise list with one-line descriptions of key dirs>

## Dependencies

<top 10-15 dependencies — prefer runtime deps over dev-only>

## Scripts

<script names with brief purpose>

## Recent Commits

<last 10 commits as bullet list>

## Key Patterns

<keyPatterns as bullet list>
```

### Step 7 — Write Markdown

Save to `~/Documents/ai-usage/knowledge-base/repo-context/<slug>.md` using the Write tool.

## Rules

- **Cache-first.** Always check gitHead before scanning. Never regenerate a fresh cache.
- **Read before writing.** Check for existing JSON before overwriting.
- **No fabrication.** Only document what you observe. Do not guess or invent patterns.
- **Complete both outputs.** Both JSON and markdown must be written — never only one.
- **Haiku budget.** Use lightweight analysis. Do not read every file exhaustively.
- **Report on completion.** Add ticket comment (if on a ticket) or create FYI ticket summarizing result.
