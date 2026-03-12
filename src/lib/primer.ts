import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import type { TeamConfig } from "./types.js";

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
  resolveFile: (relpath: string) => string | undefined;
  configDir: string;
  homeDir: string;
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
    resolveFile,
    configDir,
    homeDir,
  } = opts;

  const agentNames = teamConfig.agents.map((a) => a.name);
  const agentsList = agentNames.map((n) => `  - ${n}`).join("\n");

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
agents:
${agentsList}
</deployment-context>

Your identity is **team-manager** (team: **${teamName}**, deployment: **${deployId}**).
You MUST follow all rules in the **Global Skills** section below — especially \`standards.md\`.

## Team Description
${teamConfig.description}

## Agents

`;

  // Add agent sections with skill files
  for (const agent of teamConfig.agents) {
    primer += `### Agent: ${agent.name}\n`;
    primer += `Role: ${agent.role}\n`;

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

  // Objective — content from YAML block scalar already ends with \n
  primer += `\n## Objective\n\n${teamConfig.objective}`;

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
