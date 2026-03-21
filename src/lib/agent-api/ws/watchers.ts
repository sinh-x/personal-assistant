import {
  watch,
  readdirSync,
  readFileSync,
  statSync,
  existsSync,
} from "node:fs";
import type { FSWatcher } from "node:fs";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import type { WsHub } from "./hub.js";

const AI_USAGE = join(homedir(), "Documents", "ai-usage");
const INBOX_DIR = join(AI_USAGE, "sinh-inputs", "inbox");
const REGISTRY_FILE = join(AI_USAGE, "deployments", "registry.jsonl");
const TICKETS_DIR = join(AI_USAGE, "tickets");

function debounce<T extends unknown[]>(
  fn: (...args: T) => void,
  ms: number,
): (...args: T) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: T) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function extractTitle(filepath: string): string {
  try {
    const content = readFileSync(filepath, "utf8");
    const firstLine = content.split("\n")[0].trim();
    if (firstLine.startsWith("# ")) return firstLine.slice(2);
  } catch {
    /* ignore */
  }
  return basename(filepath, ".md");
}

function getLastRegistryEntry(file: string): Record<string, unknown> | null {
  try {
    const content = readFileSync(file, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);
    const lastLine = lines[lines.length - 1];
    if (lastLine) return JSON.parse(lastLine) as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  return null;
}

export interface FileWatchers {
  cleanup: () => void;
}

export function startWatchers(hub: WsHub): FileWatchers {
  const fsWatchers: FSWatcher[] = [];

  // --- Inbox watcher ---
  let knownInboxFiles: Set<string> = new Set();
  try {
    if (existsSync(INBOX_DIR)) {
      knownInboxFiles = new Set(
        readdirSync(INBOX_DIR).filter((f) => f.endsWith(".md")),
      );
    }
  } catch {
    /* ignore */
  }

  const scanInbox = debounce(() => {
    try {
      const current = new Set(
        existsSync(INBOX_DIR)
          ? readdirSync(INBOX_DIR).filter((f) => f.endsWith(".md"))
          : [],
      );

      for (const f of current) {
        if (!knownInboxFiles.has(f)) {
          const filepath = join(INBOX_DIR, f);
          hub.broadcast({
            type: "new-inbox-item",
            data: { filename: f, title: extractTitle(filepath) },
            timestamp: new Date().toISOString(),
          });
        }
      }

      for (const f of knownInboxFiles) {
        if (!current.has(f)) {
          hub.broadcast({
            type: "inbox-item-moved",
            data: { filename: f, from: "inbox", to: "unknown" },
            timestamp: new Date().toISOString(),
          });
        }
      }

      knownInboxFiles = current;
    } catch {
      /* ignore */
    }
  }, 100);

  try {
    if (existsSync(INBOX_DIR)) {
      const w = watch(INBOX_DIR, () => scanInbox());
      w.on("error", () => {
        /* ignore */
      });
      fsWatchers.push(w);
    }
  } catch {
    /* ignore */
  }

  // --- Registry watcher ---
  let lastRegistrySize = 0;
  try {
    if (existsSync(REGISTRY_FILE)) {
      lastRegistrySize = statSync(REGISTRY_FILE).size;
    }
  } catch {
    /* ignore */
  }

  const scanRegistry = debounce(() => {
    try {
      if (!existsSync(REGISTRY_FILE)) return;
      const currentSize = statSync(REGISTRY_FILE).size;
      if (currentSize <= lastRegistrySize) return;
      lastRegistrySize = currentSize;
      const entry = getLastRegistryEntry(REGISTRY_FILE);
      if (entry) {
        hub.broadcast({
          type: "deployment-status-change",
          data: entry,
          timestamp: new Date().toISOString(),
        });
      }
    } catch {
      /* ignore */
    }
  }, 100);

  try {
    if (existsSync(REGISTRY_FILE)) {
      const w = watch(REGISTRY_FILE, () => scanRegistry());
      w.on("error", () => {
        /* ignore */
      });
      fsWatchers.push(w);
    }
  } catch {
    /* ignore */
  }

  // --- Tickets watcher ---
  const scanTickets = debounce((filename: string | null) => {
    try {
      if (!filename || !filename.endsWith(".json") || filename === "counter.json") return;
      const ticketId = basename(filename, ".json");
      hub.broadcast({
        type: "ticket-changed",
        data: { ticketId },
        timestamp: new Date().toISOString(),
      });
    } catch {
      /* ignore */
    }
  }, 100);

  try {
    if (existsSync(TICKETS_DIR)) {
      const w = watch(TICKETS_DIR, (_evt, filename) => scanTickets(filename));
      w.on("error", () => {
        /* ignore */
      });
      fsWatchers.push(w);
    }
  } catch {
    /* ignore */
  }

  return {
    cleanup: () => {
      for (const w of fsWatchers) {
        try {
          w.close();
        } catch {
          /* ignore */
        }
      }
    },
  };
}
