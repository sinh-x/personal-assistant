import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import type { TeamConfig, DeployMode } from "./types.js";

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

  // Resolve active mode config
  const modeConfig: DeployMode | undefined = deployMode
    ? teamConfig.deploy_modes?.find((m) => m.id === deployMode)
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

  const modeBlock = deployMode ? `\nmode: ${deployMode}` : "";

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
      primer += `- ${skill}\n`;
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

  // Inject global skills (merge PA_CONFIG + PA_HOME, config wins)
  primer += "## Global Skills (apply to ALL agents)\n\n";

  const seenSkills = new Set<string>();
  const globalDirs: string[] = [];
  if (configDir) {
    globalDirs.push(resolve(configDir, "skills/global"));
  }
  globalDirs.push(resolve(homeDir, "skills/global"));

  for (const gdir of globalDirs) {
    if (!existsSync(gdir)) continue;
    const files = readdirSync(gdir)
      .filter((f) => f.endsWith(".md"))
      .sort();
    for (const file of files) {
      const skillName = basename(file, ".md");
      if (seenSkills.has(skillName)) continue;
      seenSkills.add(skillName);

      const content = readFileSync(resolve(gdir, file), "utf-8");
      primer += `<global-skill name="${skillName}">\n`;
      primer += content;
      // In bash: cat content + echo "" + echo "</global-skill>" + echo ""
      // content ends with \n, then blank line, then closing tag, then blank line
      if (!content.endsWith("\n")) primer += "\n";
      primer += "\n</global-skill>\n\n";
    }
  }

  // Objective — use mode file content if available, else fall back to YAML objective
  let objectiveContent: string = teamConfig.objective;
  if (modeConfig?.objective) {
    const objectivePath = resolveFile(modeConfig.objective);
    if (objectivePath && existsSync(objectivePath)) {
      objectiveContent = readFileSync(objectivePath, "utf-8");
    }
  }
  // objectiveContent typically ends with \n
  primer += `\n## Objective\n\n${objectiveContent}`;

  // Extra objective (if provided)
  if (extraObjective) {
    primer += `\n## Additional Instructions\n\n${extraObjective}\n`;
  }

  // Deployment instructions
  primer += `
## Deployment Instructions

1. **Read the global standards** in the Global Skills section — especially \`standards.md\`
2. **Create the team** using TeamCreate with team name "${teamName}"
3. **Spawn each agent** — pass deployment context per standards §3 (deployment_id, team_name, parent)
4. **Create tasks** from the objective and assign to agents
5. **Coordinate** — monitor via TaskList, unblock as needed
6. **Shutdown sequence** — follow standards §6: sub-agents log → agents log → you log → write completion marker → exit
`;

  return primer;
}
