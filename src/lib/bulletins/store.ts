import { execSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  renameSync,
} from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { getBulletinsDir } from "../paths.js";
import { parseBulletin, serializeBulletin } from "./types.js";
import type { Bulletin, BulletinBlock } from "./types.js";

/**
 * BulletinStore — manages bulletin lifecycle: create, list active, resolve.
 *
 * Storage layout:
 *   ~/Documents/ai-usage/bulletins/
 *     counter.json        — {"next": 3}
 *     .bulletins.lock     — flock lock file
 *     active/             — currently active bulletins (markdown + YAML frontmatter)
 *     resolved/           — deactivated bulletins (archive)
 */
export class BulletinStore {
  private readonly baseDir: string;
  private readonly activeDir: string;
  private readonly resolvedDir: string;
  private readonly lockPath: string;
  private readonly counterPath: string;

  constructor() {
    this.baseDir = getBulletinsDir();
    this.activeDir = resolve(this.baseDir, "active");
    this.resolvedDir = resolve(this.baseDir, "resolved");
    this.lockPath = resolve(this.baseDir, ".bulletins.lock");
    this.counterPath = resolve(this.baseDir, "counter.json");
    mkdirSync(this.activeDir, { recursive: true });
    mkdirSync(this.resolvedDir, { recursive: true });
    if (!existsSync(this.lockPath)) writeFileSync(this.lockPath, "");
  }

  /**
   * Allocate the next bulletin ID (B-001, B-002, etc.) atomically under flock.
   * Uses a temp file to avoid newline/quoting issues (same pattern as TicketStore).
   */
  private allocateId(): string {
    const counterPath = this.counterPath;
    const lockPath = this.lockPath;

    const script = [
      "const fs = require('fs');",
      `const cp = ${JSON.stringify(counterPath)};`,
      "const data = fs.existsSync(cp) ? JSON.parse(fs.readFileSync(cp, 'utf8')) : { next: 1 };",
      "const n = data.next;",
      "data.next = n + 1;",
      "fs.writeFileSync(cp, JSON.stringify(data, null, 2));",
      "process.stdout.write(String(n));",
    ].join("\n");

    const tmpFile = resolve(
      tmpdir(),
      `pa-bulletin-counter-${Date.now()}-${Math.random().toString(36).slice(2)}.cjs`
    );
    writeFileSync(tmpFile, script);

    try {
      const result = execSync(
        `flock -w 5 ${JSON.stringify(lockPath)} node ${JSON.stringify(tmpFile)}`
      )
        .toString()
        .trim();

      const num = parseInt(result, 10);
      return `B-${String(num).padStart(3, "0")}`;
    } finally {
      try {
        writeFileSync(tmpFile, "");
      } catch {
        /* ignore cleanup errors */
      }
    }
  }

  /** Slugify a title for use in the filename */
  private slugify(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50);
  }

  /** Read all active bulletins */
  readActive(): Bulletin[] {
    if (!existsSync(this.activeDir)) return [];
    return readdirSync(this.activeDir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => {
        const content = readFileSync(resolve(this.activeDir, f), "utf-8");
        return parseBulletin(content, f);
      })
      .filter((b): b is Bulletin => b !== null && b !== undefined);
  }

  /** Create a new active bulletin. Returns the created Bulletin. */
  create(opts: {
    title: string;
    block: BulletinBlock;
    except?: string[];
    body: string;
  }): Bulletin {
    const id = this.allocateId();
    const now = new Date().toISOString();
    const datePrefix = now.slice(0, 10);
    const slug = this.slugify(opts.title);
    const filename = `${datePrefix}-${slug}.md`;

    const bulletin: Omit<Bulletin, "filename"> = {
      id,
      title: opts.title,
      status: "active",
      block: opts.block,
      except: opts.except ?? [],
      created: now,
      body: opts.body,
    };

    const content = serializeBulletin(bulletin);
    writeFileSync(resolve(this.activeDir, filename), content);

    return { ...bulletin, filename };
  }

  /**
   * Resolve (deactivate) a bulletin by ID.
   * Moves the file from active/ to resolved/ and updates status to "resolved".
   * Returns true if found and resolved, false if not found.
   */
  resolve(id: string): boolean {
    if (!existsSync(this.activeDir)) return false;

    for (const filename of readdirSync(this.activeDir).filter((f) => f.endsWith(".md"))) {
      const filePath = resolve(this.activeDir, filename);
      const content = readFileSync(filePath, "utf-8");
      const bulletin = parseBulletin(content, filename);

      if (bulletin && bulletin.id === id) {
        const updated = serializeBulletin({ ...bulletin, status: "resolved" });
        const destPath = resolve(this.resolvedDir, filename);
        writeFileSync(filePath, updated);
        renameSync(filePath, destPath);
        return true;
      }
    }

    return false;
  }
}
