/**
 * Config routes.
 *
 * GET /api/config/feedback-chips — return feedback chip labels
 *
 * Reads from ~/Documents/ai-usage/feedback-chips.yaml.
 * Creates the file with defaults if missing.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const AI_USAGE = join(homedir(), "Documents", "ai-usage");
const CHIP_CONFIG_PATH = join(AI_USAGE, "feedback-chips.yaml");

const DEFAULT_CHIPS = [
  "Needs more detail",
  "Good, follow up on X",
  "Revisit next sprint",
  "Looks good, minor tweaks",
  "Needs full rework",
  "Blocked by dependency",
  "Secretary: create follow-up task",
];

function parseChipsYaml(yaml: string): string[] {
  const chips: string[] = [];
  let inChips = false;
  for (const rawLine of yaml.split("\n")) {
    const line = rawLine.trimEnd();
    if (line.trim() === "chips:") {
      inChips = true;
      continue;
    }
    if (inChips) {
      if (!line) continue;
      if (!line.startsWith(" ") && !line.startsWith("\t")) {
        inChips = false;
        continue;
      }
      const trimmed = line.trim();
      if (trimmed.startsWith("- ")) {
        let value = trimmed.substring(2).trim();
        if (
          value.length >= 2 &&
          ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'")))
        ) {
          value = value.substring(1, value.length - 1);
        }
        if (value) chips.push(value);
      }
    }
  }
  return chips;
}

function buildDefaultChipsYaml(): string {
  const lines = ["chips:"];
  for (const chip of DEFAULT_CHIPS) {
    const escaped = chip.replace(/"/g, '\\"');
    lines.push(`  - "${escaped}"`);
  }
  return lines.join("\n") + "\n";
}

export function configRoutes(): Hono {
  const app = new Hono();

  app.get("/api/config/feedback-chips", (c: Context) => {
    let chips: string[];

    if (!existsSync(CHIP_CONFIG_PATH)) {
      try {
        writeFileSync(CHIP_CONFIG_PATH, buildDefaultChipsYaml(), "utf8");
      } catch {
        // warn only — non-fatal
        console.error("[config] could not write default chips config");
      }
      chips = DEFAULT_CHIPS;
    } else {
      try {
        chips = parseChipsYaml(readFileSync(CHIP_CONFIG_PATH, "utf8"));
      } catch {
        console.error("[config] malformed chips config, using defaults");
        chips = DEFAULT_CHIPS;
      }
    }

    return c.json({ chips });
  });

  return app;
}
