import { readFileSync, existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { homedir } from "node:os";
import type { TeamConfig, DeployMode } from "./types.js";
import { BulletinStore } from "./bulletins/index.js";
import { listRepos } from "./repos.js";

interface PrimerOptions {
  deployId: string;
  teamName: string;
  teamConfig: TeamConfig;
  teamFile: string;
  deployTs: string;
  registryFile: string;
  registryLock: string;
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
 */
function scanUnresolvedVars(primer: string): void {
  const matches = primer.match(/\{\{[A-Z_]+\}\}/g);
  if (!matches) return;
  for (const v of [...new Set(matches)]) {
    process.stderr.write(`Warning: unresolved template variable ${v} in primer\n`);
  }
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
 * Read cached repo context from knowledge-base and return as a primer section.
 * Returns empty string if repoRoot is not set.
 */
function injectRepoContext(repoRoot: string): string {
  const slug = resolveRepoSlug(repoRoot);
  const contextPath = resolve(homedir(), 'Documents/ai-usage/knowledge-base/repo-context', `${slug}.md`);

  let contextContent: string;
  if (existsSync(contextPath)) {
    contextContent = readFileSync(contextPath, 'utf-8');
    if (!contextContent.endsWith('\n')) contextContent += '\n';
  } else {
    contextContent = 'No pre-computed codebase knowledge available for this repo. Agent will explore independently.\n';
  }

  return `\n## Repository Context\n\n${contextContent}`;
}

interface ReferenceDoc {
  name: string;
  path: string;
  summary: string;
}

/**
 * Resolve a shared skill from ~/.claude/skills/<name>/SKILL.md and return it wrapped
 * in the XML tag specified by injectAs.
 *
 * @param name - Skill directory name (e.g., "pa-cli", "pa-session-log")
 * @param injectAs - How to wrap the content: 'global-skill', 'shared-skill', or 'reference'
 * @returns XML-wrapped skill content, or empty string if not found
 */
function resolveSharedSkill(name: string, injectAs: 'global-skill' | 'shared-skill' | 'reference'): string {
  const skillPath = resolve(homedir(), ".claude/skills", name, "SKILL.md");
  if (!existsSync(skillPath)) {
    process.stderr.write(`Warning: shared skill not found: ${skillPath}\n`);
    return "";
  }
  const content = readFileSync(skillPath, "utf-8");
  // For 'reference' type, we inject as a named reference block rather than a skill tag
  // The reference tag is used for Tier 3 on-demand docs
  const tag = injectAs === 'reference' ? 'reference' : injectAs;
  let wrapped = `<${tag} name="${name}">\n`;
  wrapped += content;
  if (!content.endsWith("\n")) wrapped += "\n";
  wrapped += `</${tag}>\n`;
  return wrapped;
}

/**
 * Returns the list of inline standards module names (Tier 1 only) to include for a given mode type.
 * Tier 1: core.md (always injected global base — identity, error handling, shutdown protocol)
 * Tier 2 (mode skills): handled separately via mode.skills[] array in generatePrimer()
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
 */
function selectReferenceModules(_modeType: string): ReferenceDoc[] {
  return [
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
  ];
}

/**
 * Generate a deployment primer document.
 * Replaces the heredoc-based primer generation in deploy.sh.
 */
export function generatePrimer(opts: PrimerOptions): string {
  const {
    deployId,
    teamName,
    teamConfig,
    deployTs,
    registryFile,
    registryLock,
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

  let primer = `# Deployment Primer: ${teamConfig.name}

You are being deployed as the team manager for "${teamConfig.name}".

<deployment-context>
deployment_id: ${deployId}
team_name: ${teamName}
team_display_name: ${teamConfig.name}
deployed_at: ${deployTs}
registry_file: ${registryFile}
registry_lock: ${registryLock}
workspace_base: ${deploymentsDir}/${deployId}
team_workspace: ~/Documents/ai-usage/agent-teams/${teamName}
${cwd ? `cwd: ${cwd}\n` : ""}${repoRoot ? `repo_root: ${repoRoot}\n` : ""}agents:
${agentsList}${modelsBlock}${modeBlock}
</deployment-context>
`;

  if (repoRoot) {
    primer += injectRepoContext(repoRoot);
  }

  primer += `
Your identity is **team-manager** (team: **${teamName}**, deployment: **${deployId}**).
You MUST follow all rules in the **Global Skills** section below — especially \`standards.md\`.

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
    // Add agent sections with skill files
    for (const agent of activeAgents) {
      primer += `### Agent: ${agent.name}\n`;
      primer += `Role: ${agent.role}\n`;

      // Add effective model line if set for this agent
      const agentEffectiveModel = effectiveModels?.agentModels[agent.name];
      if (agentEffectiveModel) {
        primer += `Model: ${agentEffectiveModel}\n`;
      }

      if (agent.skill) {
        const skillPath = resolveFile(agent.skill);
        if (skillPath && existsSync(skillPath)) {
          const skillContent = readFileSync(skillPath, "utf-8");
          primer += `\n<skill-file name="${agent.name}">\n`;
          primer += skillContent;
          // skillContent typically ends with \n, so </skill-file> goes on next line
          if (!skillContent.endsWith("\n")) primer += "\n";
          primer += "</skill-file>\n";
        }
      }
      primer += "\n";
    }
  }

  // Add mode skills section if mode has skills
  if (modeConfig?.skills?.length) {
    primer += "## Mode Skills\n\n";
    primer += `Skills available in **${modeConfig.id}** mode:\n\n`;
    for (const skill of modeConfig.skills) {
      primer += `- ${skill.name} (${skill['inject-as']})\n`;
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

  // Inject global skills — standards modules selected by mode type
  primer += "## Global Skills (apply to ALL agents)\n\n";

  const modeType = modeConfig?.mode_type ?? 'work';
  const selectedModules = selectModules(modeType);
  const referenceModules = selectReferenceModules(modeType);
  const seenModules = new Set<string>();
  const referenceNames = new Set(referenceModules.map(r => r.name));

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

  // Layer 2: Shared skills from mode.skills[] (resolved from ~/.claude/skills/)
  if (modeConfig?.skills?.length) {
    for (const skillEntry of modeConfig.skills) {
      const resolved = resolveSharedSkill(skillEntry.name, skillEntry['inject-as']);
      if (resolved) {
        primer += resolved;
        primer += "\n";
      }
    }
  }

  // Inject team/mode-scoped global docs (e.g. kanban-workflow, workflow-policy)
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

  // Add Reference Documents section (Tier 3 — on-demand reference docs)
  if (referenceModules.length > 0) {
    primer += `## Reference Documents (read on demand)

> These documents are available for detailed reference. Use the Read tool to access them when you need specific guidance.

| Document | Path | When to read |
|----------|------|-------------|
`;
    for (const ref of referenceModules) {
      primer += `| ${ref.name.replace(/-/g, ' ')} | \`${ref.path}\` | ${ref.summary} |\n`;
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
  primer += `\n## Objective\n\n${objectiveContent}`;

  // Extra objective (if provided)
  if (extraObjective) {
    primer += `\n## Additional Instructions\n\n${extraObjective}\n`;
  }

  // Deployment instructions — simplified for solo modes
  const isSolo = modeConfig?.solo === true || agentNames.length === 0;
  if (isSolo) {
    primer += `
## Deployment Instructions

1. **Read the global standards** in the Global Skills section — especially \`standards.md\`
2. **Work on the objective** — you are a SOLO operator, do all work yourself, no sub-agents
3. **Shutdown sequence** — follow standards §6: write session log → write completion marker → exit
`;
  } else {
    primer += `
## Deployment Instructions

1. **Read the global standards** in the Global Skills section — especially \`standards.md\`
2. **Create the team** using TeamCreate with team name "${teamName}"
3. **Spawn each agent** — pass deployment context per standards §3 (deployment_id, team_name, parent)
4. **Create tasks** from the objective and assign to agents
5. **Coordinate** — monitor via TaskList, unblock as needed
6. **Shutdown sequence** — follow standards §6: sub-agents log → agents log → you log → write completion marker → exit
`;
  }

  scanUnresolvedVars(primer);
  return primer;
}
