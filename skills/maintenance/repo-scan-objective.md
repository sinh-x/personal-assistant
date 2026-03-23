You are a SOLO operator in repo-scan mode — do ALL work yourself, do NOT spawn sub-agents.

## Objective

Generate or refresh the cached codebase summary for repository: **{{REPO_KEY}}**

Follow `skills/maintenance/repo-scan.md` exactly.

## Steps

1. Resolve the repo path for `{{REPO_KEY}}`:
   ```bash
   pa repos list
   ```
   Find the entry matching `{{REPO_KEY}}` and note its absolute path.

2. **Cache check** — compare stored `gitHead` with current HEAD:
   ```bash
   git -C <repo_path> rev-parse HEAD
   # Compare against gitHead in ~/Documents/ai-usage/knowledge-base/repo-context/{{REPO_KEY}}.json
   ```
   If they match: log "Cache hit — no regeneration needed" and skip to Step 6.

3. **Full scan** — execute Steps 1–7 from `skills/maintenance/repo-scan.md`:
   - Gather raw data (file tree, commits, manifest, README)
   - Detect language/framework
   - Identify key patterns (read 3-5 key source files)
   - Build JSON
   - Write `knowledge-base/repo-context/{{REPO_KEY}}.json`
   - Render markdown
   - Write `knowledge-base/repo-context/{{REPO_KEY}}.md`

4. **Verify** — confirm both output files exist and JSON is valid:
   ```bash
   ls -la ~/Documents/ai-usage/knowledge-base/repo-context/{{REPO_KEY}}.*
   ```

5. **Write session log** to `~/Documents/ai-usage/sessions/YYYY/MM/agent-team/`.

6. **Report completion** — if working on a ticket:
   ```bash
   pa ticket comment <id> --author mechanic \
     --content "Repo scan complete for {{REPO_KEY}}: <fresh|cache-hit>. Output: knowledge-base/repo-context/{{REPO_KEY}}.md. gitHead: <hash>. Session log: sessions/YYYY/MM/agent-team/<filename>.md"
   ```
   If no ticket:
   ```bash
   pa ticket create \
     --project personal-assistant \
     --type fyi \
     --assignee sinh \
     --priority low \
     --estimate XS \
     --title "FYI: Repo scan complete — {{REPO_KEY}}" \
     --summary "Codebase summary generated for {{REPO_KEY}} at knowledge-base/repo-context/{{REPO_KEY}}.md. gitHead: <hash>. Status: <fresh|cache-hit>."
   ```
