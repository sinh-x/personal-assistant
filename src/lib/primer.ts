import { readFileSync, existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import type { TeamConfig, DeployMode } from "./types.js";
import { BulletinStore } from "./bulletins/index.js";
import { listRepos } from "./repos.js";
import { graphExists, loadGraph, getCodeContextDir } from "./codectx/json-store.js";
import { computeStats, getTopExports } from "./codectx/graph-builder.js";

interface ImprovementFocusItem {
  id: string;
  title: string;
  category: string;
  scope: string;
  recurrence: string;
}

/**
 * Read improvement-focus.md and return filtered items scoped to the given agent/team.
 * Returns at most 10 lines of formatted output.
 * Returns empty string if file not found or no matching items.
 */
function injectImprovementFocus(
  resolveFile: (relpath: string) => string | undefined,
  homeDir: string,
  agentNames: string[],
  teamName: string,
): string {
  const focusPath = resolveFile("knowledge-base/improvement-focus.md");
  if (!focusPath || !existsSync(focusPath)) {
    return "";
  }

  let content: string;
  try {
    content = readFileSync(focusPath, "utf-8");
  } catch {
    return "";
  }

  // Parse the table: find rows after "## Top 3 Focus Items"
  const tableStart = content.indexOf("## Top 3 Focus Items");
  if (tableStart === -1) return "";

  const tableEnd = content.indexOf("## Injection Format", tableStart);
  const tableSection = tableEnd !== -1 ? content.slice(tableStart, tableEnd) : content.slice(tableStart);

  // Parse table rows (skip header and separator rows)
  const lines = tableSection.split("\n");
  const items: ImprovementFocusItem[] = [];
  let inTable = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("| # |")) {
      inTable = true;
      continue;
    }
    if (trimmed.startsWith("|---")) continue;
    if (!inTable || !trimmed || trimmed.startsWith("#") || trimmed.startsWith(">")) continue;
    if (trimmed.startsWith("Example")) break;

    const cells = trimmed.split("|").filter((c) => c.trim() !== "");
    if (cells.length >= 5) {
      const id = cells[1].trim();
      const title = cells[2].trim();
      const category = cells[3].trim();
      const scope = cells[4].trim();
      const recurrence = cells[5]?.trim() ?? "";
      if (id.startsWith("IMP-")) {
        items.push({ id, title, category, scope, recurrence });
      }
    }
  }

  // Filter items by scope: "all", team name, or agent name
  const filtered = items.filter((item) => {
    const scope = item.scope.toLowerCase();
    if (scope === "all") return true;
    if (scope === teamName.toLowerCase()) return true;
    return agentNames.some((n) => n.toLowerCase() === scope);
  });

  if (filtered.length === 0) return "";

  // Format as markdown list, max 10 lines total
  const lines_out: string[] = ["## Improvement Focus", ""];
  for (const item of filtered.slice(0, 3)) {
    lines_out.push(`- **[${item.id}]** (${item.category}, ${item.scope}) — ${item.title}`);
  }

  return lines_out.slice(0, 10).join("\n") + "\n\n";
}

/**
 * Inject a Codebase Context section into the primer if a graph exists for the repo.
 * Returns empty string if no graph is available.
 */
function injectCodeContext(
  repoRoot: string | undefined,
): string {
  if (!repoRoot) return "";

  const repoName = basename(repoRoot);
  const dataDir = getCodeContextDir();

  if (!graphExists(repoName, dataDir)) {
    return "";
  }

  const graph = loadGraph(repoName, dataDir);
  if (!graph) return "";

  const stats = computeStats(graph);
  const topExports = getTopExports(graph);

  // Find key modules — files with the most declaration nodes
  // Filter to src/ files and sort by declaration count
  const fileDeclarationCounts: { file: string; count: number }[] = [];
  for (const [file, nodeIds] of Object.entries(graph.fileIndex)) {
    // Count non-file nodes (actual declarations)
    const declCount = nodeIds.filter((id) => {
      const node = graph.nodes[id];
      return node && node.type !== "file";
    }).length;
    if (declCount > 0 && file.includes("/src/")) {
      fileDeclarationCounts.push({ file, count: declCount });
    }
  }

  // Sort by declaration count descending and take top 5
  fileDeclarationCounts.sort((a, b) => b.count - a.count);
  const keyModules = fileDeclarationCounts.slice(0, 5);

  // Build the section
  const lines: string[] = ["## Codebase Context\n"];

  // Stats line
  lines.push(
    `**Files:** ${stats.files} | **Functions:** ${stats.functions} | **Classes:** ${stats.classes}`
  );
  lines.push("");

  // Top-level exports (max 10)
  if (topExports.length > 0) {
    const exportSlice = topExports.slice(0, 10);
    lines.push(`**Top-level exports:** ${exportSlice.join(", ")}`);
    lines.push("");
  }

  // Key modules
  if (keyModules.length > 0) {
    lines.push("**Key modules:**");
    for (const mod of keyModules) {
      // Get a brief description from the file node's exports or just show the file
      const relPath = mod.file.replace(repoRoot + "/", "");
      lines.push(`- \`${relPath}\` — ${mod.count} declarations`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

interface PrimerOptions {
  deployId: string;
  teamName: string;
  teamConfig: TeamConfig;
  teamFile: string;
  deployTs: string;
  registryDb: string;
  deploymentsDir: string;
  extraObjective?: string;
  deployMode?: string;
  cwd?: string;
  repoRoot?: string;
  resolveFile: (relpath: string) => string | undefined;
  configDir: string;
  homeDir: string;
  effectiveModels?: {
    tmModel: string | undefined;
    agentModels: Record<string, string | undefined>;
  };
  /** Caller-provided template variables to substitute in mode objective files. Overrides standard vars. */
  templateVars?: Record<string, string>;
  /** Ticket ID linked to this deployment (e.g., PA-042). Injected into deployment-context for agent awareness. */
  ticket?: string;
}

/** Format a Date as YYYY-MM-DD */
function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Scan primer content for unresolved {{KEY}} template variables and emit stderr warnings.
 * Soft warning only — does not modify or reject the primer.
 * @returns Array of warning messages (one per unresolved variable, deduplicated)
 */
function scanUnresolvedVars(primer: string): string[] {
  const warnings: string[] = [];
  const matches = primer.match(/\{\{[A-Z_]+\}\}/g);
  if (!matches) return warnings;
  for (const v of [...new Set(matches)]) {
    const msg = `Warning: unresolved template variable ${v} in primer`;
    warnings.push(msg);
    process.stderr.write(`${msg}\n`);
  }
  return warnings;
}

/**
 * Apply {{KEY}} template variable substitution to content.
 * Backward compatible — files without {{VAR}} placeholders pass through unchanged.
 */
function applyTemplateVars(content: string, vars: Record<string, string>): string {
  let result = content;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}

/** Resolve a repo path to its registry key (slug). Falls back to directory basename. */
function resolveRepoSlug(repoRoot: string): string {
  try {
    for (const repo of listRepos()) {
      if (repo.path === repoRoot) {
        return repo.name;
      }
    }
  } catch {
    // Repos.yaml unavailable — fall through to basename
  }
  return basename(repoRoot);
}

/**
 * Resolve GitHub owner/repo from a repo's git remote URL.
 * Handles both SSH (git@github.com:owner/repo.git) and HTTPS (https://github.com/owner/repo.git) formats.
 * Returns undefined if no remote is configured.
 */
export function resolveGhRepo(repoRoot: string): string | undefined {
  try {
    const url = execSync(`git -C "${repoRoot}" remote get-url origin`, { encoding: "utf-8" }).trim();
    // SSH: git@github.com:owner/repo.git → owner/repo
    const sshMatch = url.match(/github\.com[:/](.+?)(?:\.git)?$/);
    if (sshMatch) return sshMatch[1];
    // HTTPS: https://github.com/owner/repo.git → owner/repo
    const httpsMatch = url.match(/github\.com\/(.+?)(?:\.git)?$/);
    if (httpsMatch) return httpsMatch[1];
  } catch {
    // No remote or not a git repo — fall through to undefined
  }
  return undefined;
}

interface ReferenceDoc {
  name: string;
  path: string;
  summary: string;
}

/**
 * Read a shared skill's SKILL.md frontmatter (name + description) and return
 * a Markdown table row for the Available Skills summary table.
 *
 * @param name - Skill directory name (e.g., "pa-cli", "pa-session-log")
 * @returns Markdown table row string, or empty string if not found
 */
function resolveSkillSummary(name: string): string {
  const skillPath = resolve(homedir(), ".claude/skills", name, "SKILL.md");
  if (!existsSync(skillPath)) {
    process.stderr.write(`Warning: shared skill not found: ${skillPath}\n`);
    return "";
  }
  const content = readFileSync(skillPath, "utf-8");

  // Extract YAML frontmatter between --- delimiters
  const fmEnd = content.indexOf('\n---', 4);
  if (!content.startsWith('---\n') || fmEnd === -1) {
    return `| ${name} | (no description) | ~/.claude/skills/${name}/SKILL.md |\n`;
  }
  const frontmatter = content.slice(4, fmEnd);

  // Parse description — handles both single-line and YAML block scalar (>)
  const lines = frontmatter.split('\n');
  let description = '';
  let inDescBlock = false;

  for (const line of lines) {
    if (inDescBlock) {
      if (line.startsWith('  ') || line.startsWith('\t')) {
        description += (description ? ' ' : '') + line.trim();
      } else {
        break;
      }
    } else if (line.startsWith('description:')) {
      const afterColon = line.slice('description:'.length).trim();
      if (afterColon === '>' || afterColon === '|') {
        inDescBlock = true;
      } else {
        description = afterColon;
        break;
      }
    }
  }

  return `| ${name} | ${description} | ~/.claude/skills/${name}/SKILL.md |\n`;
}

/**
 * Returns the list of inline standards module names (Tier 1 only) to include for a given mode type.
 * Tier 1: core.md (always injected global base — identity, error handling, shutdown protocol)
 * Tier 2 (mode skills): rendered as summary table via resolveSkillSummary()
 * Tier 3: kanban-workflow, workflow-policy, codebase-exploration, impact-analysis → on-demand reference
 */
function selectModules(_modeType: string): string[] {
  // Only core.md is always-injected as the global base.
  // All other skills are explicitly listed in the mode's skills[] array.
  return ['core'];
}

/**
 * Returns the list of on-demand reference documents (Tier 3) for a given mode type.
 * These are listed in the Reference Documents section rather than injected inline.
 * If repoRoot is set, repo context is added as the first entry.
 *
 * @param _modeType - The mode type (e.g., 'work', 'review')
 * @param repoRoot - Optional repo root path for repo context
 * @param teamName - Optional team name for template filtering
 * @param deployMode - Optional deploy mode (e.g., 'implement', 'orchestrate') for template filtering
 */
function selectReferenceModules(
  _modeType: string,
  repoRoot?: string,
  teamName?: string,
  deployMode?: string,
): ReferenceDoc[] {
  const refs: ReferenceDoc[] = [];

  if (repoRoot) {
    const slug = resolveRepoSlug(repoRoot);
    refs.push({
      name: 'repo context',
      path: `knowledge-base/repo-context/${slug}.md`,
      summary: 'Before modifying code — provides file tree, dependencies, and key patterns',
    });
  }

  refs.push(
    {
      name: 'kanban-workflow',
      path: 'skills/global/standards/kanban-workflow.md',
      summary: 'Before making ticket status transitions — defines lifecycle, role ownership, Sinh gates',
    },
    {
      name: 'workflow-policy',
      path: 'skills/global/policy/workflow-policy.md',
      summary: 'For edge cases: UAT skip conditions, bug fast-track, executor selection. Overrides kanban-workflow',
    },
    {
      name: 'codebase-exploration',
      path: 'skills/global/standards/codebase-exploration.md',
      summary: 'Before modifying code in an unfamiliar repo — entry-point identification and deep dives',
    },
    {
      name: 'impact-analysis',
      path: 'skills/global/standards/impact-analysis.md',
      summary: 'When ticket has doc_refs to a plan — identifies change surface and downstream consumers',
    },
  );

  // Add templates filtered by team/mode relevance
  const templates = resolveTemplates(repoRoot, teamName, deployMode);
  refs.push(...templates);

  return refs;
}

/**
 * Resolve and filter lifecycle templates based on team and deploy mode.
 * Templates are listed in the Reference Documents table as on-demand Read references.
 */
function resolveTemplates(
  repoRoot?: string,
  teamName?: string,
  deployMode?: string,
): ReferenceDoc[] {
  if (!repoRoot) return [];

  const templatesDir = resolve(repoRoot, 'skills/templates');
  if (!existsSync(templatesDir)) {
    return [];
  }

  // Template filtering rules per team/mode:
  // - requirements team: requirements.md, idea-intake.md
  // - builder orchestrator: builder-objective.md, uat-review.md
  // - builder implement: implementation-artifact.md, uat-review.md
  // - maintenance: uat-review.md
  // - all teams: done-summary.md (lightweight, broadly useful)
  interface TemplateSpec {
    filename: string;
    docName: string;
    summary: string;
    team?: string;
    mode?: string;
  }

  const templateSpecs: TemplateSpec[] = [
    {
      filename: 'requirements.md',
      docName: 'requirements-template',
      summary: 'Before producing a requirements document',
      team: 'requirements',
    },
    {
      filename: 'idea-intake.md',
      docName: 'idea-intake-template',
      summary: 'Before capturing a new idea or feature',
      team: 'requirements',
    },
    {
      filename: 'builder-objective.md',
      docName: 'builder-objective-template',
      summary: 'Before composing builder sub-deployment objectives',
      team: 'builder',
      mode: 'orchestrator',
    },
    {
      filename: 'implementation-artifact.md',
      docName: 'implementation-artifact-template',
      summary: 'Before composing implementation artifact for UAT handoff',
      team: 'builder',
      mode: 'implement',
    },
    {
      filename: 'uat-review.md',
      docName: 'uat-review-template',
      summary: 'Before handing off to review-uat',
      team: 'builder',
      mode: 'orchestrator',
    },
    {
      filename: 'uat-review.md',
      docName: 'uat-review-template',
      summary: 'Before handing off to review-uat',
      team: 'builder',
      mode: 'implement',
    },
    {
      filename: 'uat-review.md',
      docName: 'uat-review-template',
      summary: 'Before handing off to review-uat',
      team: 'maintenance',
    },
    {
      filename: 'done-summary.md',
      docName: 'done-summary-template',
      summary: 'Lightweight summary for ticket closure — useful for all teams',
    },
  ];

  const seen = new Set<string>();
  const result: ReferenceDoc[] = [];

  for (const spec of templateSpecs) {
    // Filter: skip if team/mode doesn't match
    if (spec.team && spec.team !== teamName) continue;
    if (spec.team && spec.mode && spec.mode !== deployMode) continue;

    // Skip duplicates (e.g., uat-review.md appears for multiple team/mode combos)
    if (seen.has(spec.docName)) continue;
    seen.add(spec.docName);

    const fullPath = resolve(templatesDir, spec.filename);
    if (!existsSync(fullPath)) continue;

    result.push({
      name: spec.docName,
      path: `skills/templates/${spec.filename}`,
      summary: spec.summary,
    });
  }

  return result;
}

/**
 * Generate a deployment primer document.
 * Structure follows WHO → WHY → WHAT → HOW:
 *   WHO:  deployment-context, team description, hierarchy, agents
 *   WHY:  objective, additional instructions
 *   WHAT: available skills (summary table), model policy
 *   HOW:  core standards (inline), reference docs, bulletins, deployment instructions
 * @returns Object with primer content and any warnings from template variable scanning
 */
export function generatePrimer(opts: PrimerOptions): { content: string; warnings: string[] } {
  const {
    deployId,
    teamName,
    teamConfig,
    deployTs,
    registryDb,
    deploymentsDir,
    extraObjective,
    deployMode,
    cwd,
    repoRoot,
    resolveFile,
    configDir,
    homeDir,
    effectiveModels,
  } = opts;

  // Compute standard template variables from deploy context
  const now = new Date();
  const todayStr = formatDate(now);
  const yearStr = todayStr.slice(0, 4);
  const monthStr = todayStr.slice(5, 7);
  const rawOutputDir = teamConfig.variables?.output_dir;
  const expandedOutputDir = rawOutputDir
    ? rawOutputDir.replace(/^~/, homeDir)
    : undefined;

  // Look up repo entry from repos.yaml to get prefix, developBranch, mainBranch
  let repoEntry: { name: string; path: string; prefix?: string; mainBranch?: string; developBranch?: string } | undefined;
  if (repoRoot) {
    try {
      repoEntry = listRepos().find((r) => r.path === repoRoot);
    } catch {
      // repos.yaml unavailable — repoEntry stays undefined
    }
  }

  const ghRepo = repoRoot ? resolveGhRepo(repoRoot) : undefined;
  const standardVars: Record<string, string> = {
    TODAY: todayStr,
    YEAR: yearStr,
    MONTH: monthStr,
    HOME: homeDir,
    TEAM_NAME: teamName,
    MODE_ID: deployMode ?? "",
    DEPLOY_ID: deployId,
    ...(expandedOutputDir ? { OUTPUT_DIR: `${expandedOutputDir}/${yearStr}/${monthStr}` } : {}),
    ...(repoRoot ? { REPO_KEY: resolveRepoSlug(repoRoot) } : {}),
    ...(repoEntry?.prefix ? { PROJECT_PREFIX: repoEntry.prefix } : {}),
    ...(ghRepo ? { GH_REPO: ghRepo } : {}),
    ...(repoRoot ? { DEVELOP_BRANCH: repoEntry?.developBranch ?? "develop" } : {}),
    ...(repoRoot ? { MAIN_BRANCH: repoEntry?.mainBranch ?? "main" } : {}),
  };
  // Caller-provided vars override standard vars (e.g. daily.ts sets TODAY to a custom date)
  const allTemplateVars: Record<string, string> = { ...standardVars, ...(opts.templateVars ?? {}) };

  // Resolve active mode config (explicit > default_mode > none)
  const effectiveMode = deployMode ?? teamConfig.default_mode;
  const modeConfig: DeployMode | undefined = effectiveMode
    ? teamConfig.deploy_modes?.find((m) => m.id === effectiveMode)
    : undefined;

  // Determine active agents (mode-filtered or all)
  // modeConfig.agents === undefined → all agents
  // modeConfig.agents === []        → team-manager only (no sub-agents)
  // modeConfig.agents === ['name']  → only listed agents
  const activeAgents =
    modeConfig?.agents !== undefined
      ? teamConfig.agents.filter((a) => modeConfig.agents!.includes(a.name))
      : teamConfig.agents;

  const agentNames = activeAgents.map((a) => a.name);
  const agentsList =
    agentNames.length > 0
      ? agentNames.map((n) => `  - ${n}`).join("\n")
      : "  []";

  // Build models block for deployment-context (only if any model is set)
  let modelsBlock = "";
  if (effectiveModels) {
    const { tmModel, agentModels } = effectiveModels;
    const anySet = tmModel || Object.values(agentModels).some(Boolean);
    if (anySet) {
      const lines: string[] = ["models:"];
      if (tmModel) lines.push(`  team-manager: ${tmModel}`);
      for (const [name, m] of Object.entries(agentModels)) {
        if (m) lines.push(`  ${name}: ${m}`);
      }
      modelsBlock = "\n" + lines.join("\n");
    }
  }

  const modeBlock = effectiveMode ? `\nmode: ${effectiveMode}` : "";

  // ─── WHO AM I? ────────────────────────────────────────────────────────────

  let primer = `# Deployment Primer: ${teamConfig.name}

You are being deployed as the team manager for "${teamConfig.name}".

<deployment-context>
deployment_id: ${deployId}
team_name: ${teamName}
team_display_name: ${teamConfig.name}
deployed_at: ${deployTs}
registry_db: ${registryDb}
workspace_base: ${deploymentsDir}/${deployId}
team_workspace: ~/Documents/ai-usage/agent-teams/${teamName}
${cwd ? `cwd: ${cwd}\n` : ""}${repoRoot ? `repo_root: ${repoRoot}\n` : ""}${opts.ticket ? `ticket_id: ${opts.ticket}\n` : ""}agents:
${agentsList}${modelsBlock}${modeBlock}
</deployment-context>

## Team Description
${teamConfig.description}

`;

  // Add hierarchy section if present
  if (teamConfig.hierarchy) {
    primer += "## Hierarchy\n\n";
    const h = teamConfig.hierarchy;
    if (h["team-manager"]) {
      const tm = h["team-manager"];
      primer += `**team-manager**`;
      if (tm.role) primer += ` — ${tm.role}`;
      if (tm.participates_in) {
        const p =
          tm.participates_in === "all"
            ? "all modes"
            : Array.isArray(tm.participates_in)
              ? tm.participates_in.join(", ")
              : String(tm.participates_in);
        primer += ` (participates in: ${p})`;
      }
      primer += "\n";
    }
    if (h.agents?.length) {
      for (const agent of h.agents) {
        primer += `- **${agent.name}**`;
        if (agent.role) primer += ` — ${agent.role}`;
        if (agent.participates_in) {
          const p =
            agent.participates_in === "all"
              ? "all modes"
              : Array.isArray(agent.participates_in)
                ? agent.participates_in.join(", ")
                : String(agent.participates_in);
          primer += ` (participates in: ${p})`;
        }
        primer += "\n";
      }
    }
    primer += "\n";
  }

  primer += "## Agents\n\n";

  if (activeAgents.length === 0) {
    primer += "_No agents — team-manager only for this mode._\n\n";
  } else {
    for (const agent of activeAgents) {
      primer += `### Agent: ${agent.name}\n`;
      primer += `Role: ${agent.role}\n`;

      // Add effective model line if set for this agent
      const agentEffectiveModel = effectiveModels?.agentModels[agent.name];
      if (agentEffectiveModel) {
        primer += `Model: ${agentEffectiveModel}\n`;
      }

      // AC14 bug fix: check agent.instruction first, fall back to agent.skill
      const instructionFile = agent.instruction ?? agent.skill;
      if (instructionFile) {
        const instPath = resolveFile(instructionFile);
        if (instPath && existsSync(instPath)) {
          const instContent = readFileSync(instPath, "utf-8");
          const tag = agent.instruction ? "instruction-file" : "skill-file";
          primer += `\n<${tag} name="${agent.name}">\n`;
          primer += instContent;
          if (!instContent.endsWith("\n")) primer += "\n";
          primer += `</${tag}>\n`;
        }
      }
      primer += "\n";
    }
  }

  // ─── WHY AM I HERE? ───────────────────────────────────────────────────────

  // Objective — use mode file content if available, else fall back to YAML objective
  let objectiveContent: string = teamConfig.objective;
  if (modeConfig?.objective) {
    const objectivePath = resolveFile(modeConfig.objective);
    if (objectivePath && existsSync(objectivePath)) {
      objectiveContent = readFileSync(objectivePath, "utf-8");
    }
  }
  // Apply template variable substitution (backward compatible — files without {{VAR}} pass through unchanged)
  objectiveContent = applyTemplateVars(objectiveContent, allTemplateVars);
  // objectiveContent typically ends with \n
  primer += `## Objective\n\n${objectiveContent}`;

  // Extra objective (if provided)
  if (extraObjective) {
    primer += `\n## Additional Instructions\n\n${extraObjective}\n`;
  }

  // ─── WHAT CAN I DO? ───────────────────────────────────────────────────────

  // Available Skills — compact summary table (reads frontmatter only, not full content)
  if (modeConfig?.skills?.length) {
    primer += `\n## Available Skills\n\n`;
    primer += `> These skills are available for this deployment mode. Load them with the Read tool when needed.\n\n`;
    primer += `| Skill | Description | Path |\n`;
    primer += `|-------|-------------|------|\n`;
    for (const skill of modeConfig.skills) {
      const row = resolveSkillSummary(skill.name);
      if (row) primer += row;
    }
    primer += "\n";
  }

  // Add Model Policy section if any model is set
  if (effectiveModels) {
    const { tmModel, agentModels } = effectiveModels;
    const anySet = tmModel || Object.values(agentModels).some(Boolean);
    if (anySet) {
      primer += `## Model Policy

### Named Agents
See \`models:\` in the deployment-context block above.

### Dynamic Agent Policy

When spawning unplanned sub-agents, use this policy:

| Task type | Recommended model |
|-----------|-------------------|
| File reading, data gathering | haiku |
| Classification, cross-referencing | sonnet |
| Synthesis, planning, judgment | opus |
| User-facing interactive output | opus |
| Routine formatting, transforms | haiku |

`;
    }
  }

  // Inject improvement focus items (F11: primer injection, scoped by agent type, max 10 lines)
  const focusSection = injectImprovementFocus(resolveFile, homeDir, agentNames, teamName);
  if (focusSection) {
    primer += focusSection;
  }

  // ─── HOW DO I WORK? ───────────────────────────────────────────────────────

  // Core Standards — core.md (always injected) + any global_docs for this mode
  primer += "## Core Standards\n\n";

  const modeType = modeConfig?.mode_type ?? 'work';
  const selectedModules = selectModules(modeType);
  const referenceModules = selectReferenceModules(modeType, repoRoot, teamName, effectiveMode);
  const seenModules = new Set<string>();
  const referenceNames = new Set(referenceModules.map(r => r.name.replace(/ /g, '-')));

  const globalDirs: string[] = [];
  if (configDir) {
    globalDirs.push(resolve(configDir, "skills/global"));
  }
  globalDirs.push(resolve(homeDir, "skills/global"));

  // Layer 3: Global base — only core.md (always injected)
  for (const gdir of globalDirs) {
    if (!existsSync(gdir)) continue;
    const standardsDir = resolve(gdir, "standards");
    if (!existsSync(standardsDir)) continue;

    for (const moduleName of selectedModules) {
      if (seenModules.has(moduleName)) continue;
      const modulePath = resolve(standardsDir, `${moduleName}.md`);
      if (!existsSync(modulePath)) continue;
      seenModules.add(moduleName);

      const content = readFileSync(modulePath, "utf-8");
      primer += `<global-skill name="${moduleName}">\n`;
      primer += content;
      if (!content.endsWith("\n")) primer += "\n";
      primer += "\n</global-skill>\n\n";
    }
  }

  // Inject team/mode-scoped global docs (e.g. review-code-quality.md for review mode)
  // Team-level global_docs are the baseline; mode-level global_docs extend them. Deduplicated.
  const teamGlobalDocs = teamConfig.global_docs ?? [];
  const modeGlobalDocs = modeConfig?.global_docs ?? [];
  const allGlobalDocs = [...new Set([...teamGlobalDocs, ...modeGlobalDocs])];

  for (const docRelPath of allGlobalDocs) {
    const docPath = resolveFile(docRelPath);
    if (!docPath || !existsSync(docPath)) continue;
    const docName = docRelPath.split("/").pop()?.replace(/\.md$/, "") ?? docRelPath;
    // Skip if already injected as inline or reference module (dedup guard)
    if (seenModules.has(docName) || referenceNames.has(docName)) continue;
    seenModules.add(docName);
    const docContent = readFileSync(docPath, "utf-8");
    primer += `<global-skill name="${docName}">\n`;
    primer += docContent;
    if (!docContent.endsWith("\n")) primer += "\n";
    primer += "\n</global-skill>\n\n";
  }

  // Inject terse-mode skill if team has terse_mode: true
  if (teamConfig.terse_mode === true) {
    const terseSkillPath = resolve(homedir(), ".claude/skills", "terse-mode", "SKILL.md");
    if (existsSync(terseSkillPath)) {
      const terseContent = readFileSync(terseSkillPath, "utf-8");
      primer += `<global-skill name="terse-mode">\n`;
      primer += terseContent;
      if (!terseContent.endsWith("\n")) primer += "\n";
      primer += "\n</global-skill>\n\n";
    }
  }

  // Inject Codebase Context section if graph exists for the repo
  const codeContextSection = injectCodeContext(repoRoot);
  if (codeContextSection) {
    primer += codeContextSection;
  }

  // Reference Documents (Tier 3 — on-demand; includes repo context when repoRoot is set)
  if (referenceModules.length > 0) {
    primer += `## Reference Documents (read on demand)

> These documents are available for detailed reference. Use the Read tool to access them when needed.

| Document | Path | When to read |
|----------|------|-------------|
`;
    for (const ref of referenceModules) {
      primer += `| ${ref.name} | \`${ref.path}\` | ${ref.summary} |\n`;
    }
    primer += "\n";
  }

  // Inject active bulletins so running/sub-agents are aware of system-wide blocks
  try {
    const bulletinStore = new BulletinStore();
    const activeBulletins = bulletinStore.readActive();
    if (activeBulletins.length > 0) {
      primer += "\n## Active Bulletins\n\n";
      primer +=
        "> **WARNING:** The following bulletins are currently active. Read before starting work.\n\n";
      for (const b of activeBulletins) {
        const blockStr = b.block === "all" ? "ALL TEAMS" : b.block.join(", ");
        primer += `### [${b.id}] ${b.title}\n`;
        primer += `- **Blocks:** ${blockStr}\n`;
        if (b.except.length > 0) {
          primer += `- **Exempt:** ${b.except.join(", ")}\n`;
        }
        primer += `- **Created:** ${b.created}\n`;
        if (b.body) {
          primer += `\n${b.body}\n`;
        }
        primer += "\n";
      }
    }
  } catch {
    // Bulletins dir not yet created — skip injection silently
  }

  // Deployment instructions — includes required skills to load on startup
  const isSolo = modeConfig?.solo === true || agentNames.length === 0;
  if (isSolo) {
    primer += `
## Deployment Instructions

1. **Load required skills** — Read and follow these before starting:
   - \`~/.claude/skills/pa-session-log/SKILL.md\` (session logging)
   - \`~/.claude/skills/pa-ticket-workflow/SKILL.md\` (ticket workflow)
   - \`~/.claude/skills/pa-startup/SKILL.md\` (startup priority)
2. **Work on the objective** — you are a SOLO operator, do all work yourself, no sub-agents
3. **Shutdown sequence** — follow core standards §6: write session log → write completion marker → exit
`;
  } else {
    primer += `
## Deployment Instructions

1. **Load required skills** — Read and follow these before starting:
   - \`~/.claude/skills/pa-session-log/SKILL.md\` (session logging)
   - \`~/.claude/skills/pa-ticket-workflow/SKILL.md\` (ticket workflow)
   - \`~/.claude/skills/pa-startup/SKILL.md\` (startup priority)
2. **Create the team** using TeamCreate with team name "${teamName}"
3. **Spawn each agent** — pass deployment context per core standards §3 (deployment_id, team_name, parent)
4. **Create tasks** from the objective and assign to agents
5. **Coordinate** — monitor via TaskList, unblock as needed
6. **Shutdown sequence** — follow core standards §6: sub-agents log → agents log → you log → write completion marker → exit
`;
  }

  const warnings = scanUnresolvedVars(primer);
  return { content: primer, warnings };
}
