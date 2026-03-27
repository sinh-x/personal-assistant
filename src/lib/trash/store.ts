import { execSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  unlinkSync,
  rmSync,
} from "node:fs";
import { resolve, basename, dirname } from "node:path";
import { tmpdir } from "node:os";
import { getTrashDir } from "../paths.js";
import type { TrashEntry, TrashFileType, TrashStatus } from "./types.js";

/**
 * TrashStore — soft-delete for PA project files.
 *
 * Storage layout:
 *   ~/Documents/ai-usage/trash/
 *     manifest.jsonl    — all trash entries (read-update-write under flock)
 *     counter.json      — {"next": N} for sequential IDs (T-001, T-002, ...)
 *     .trash.lock       — flock lock file
 *     files/            — actual trashed files
 *       2026-03-25-001/ — date + ID-suffix subdirectory
 *         gather-avo.md — the trashed file
 */
export class TrashStore {
  private readonly baseDir: string;
  private readonly filesDir: string;
  private readonly lockPath: string;
  private readonly counterPath: string;
  private readonly manifestPath: string;

  constructor() {
    this.baseDir = getTrashDir();
    this.filesDir = resolve(this.baseDir, "files");
    this.lockPath = resolve(this.baseDir, ".trash.lock");
    this.counterPath = resolve(this.baseDir, "counter.json");
    this.manifestPath = resolve(this.baseDir, "manifest.jsonl");
    mkdirSync(this.filesDir, { recursive: true });
    if (!existsSync(this.lockPath)) writeFileSync(this.lockPath, "");
  }

  /**
   * Allocate the next trash ID (T-001, T-002, etc.) atomically under flock.
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
      `pa-trash-counter-${Date.now()}-${Math.random().toString(36).slice(2)}.cjs`
    );
    writeFileSync(tmpFile, script);

    try {
      const result = execSync(
        `flock -w 5 ${JSON.stringify(lockPath)} node ${JSON.stringify(tmpFile)}`
      )
        .toString()
        .trim();

      const num = parseInt(result, 10);
      return `T-${String(num).padStart(3, "0")}`;
    } finally {
      try {
        writeFileSync(tmpFile, "");
      } catch {
        /* ignore cleanup errors */
      }
    }
  }

  /** Read all manifest entries */
  private readManifest(): TrashEntry[] {
    if (!existsSync(this.manifestPath)) return [];
    const content = readFileSync(this.manifestPath, "utf-8").trim();
    if (!content) return [];
    return content.split("\n").map((line) => JSON.parse(line) as TrashEntry);
  }

  /** Write all manifest entries (read-update-write under flock) */
  private writeManifest(entries: TrashEntry[]): void {
    const data = entries.map((e) => JSON.stringify(e)).join("\n");
    const lockPath = this.lockPath;
    const manifestPath = this.manifestPath;

    const tmpFile = resolve(
      tmpdir(),
      `pa-trash-manifest-${Date.now()}-${Math.random().toString(36).slice(2)}.cjs`
    );
    const script = [
      "const fs = require('fs');",
      `fs.writeFileSync(${JSON.stringify(manifestPath)}, ${JSON.stringify(data + "\n")});`,
    ].join("\n");
    writeFileSync(tmpFile, script);

    try {
      execSync(
        `flock -w 5 ${JSON.stringify(lockPath)} node ${JSON.stringify(tmpFile)}`
      );
    } finally {
      try {
        writeFileSync(tmpFile, "");
      } catch {
        /* ignore cleanup errors */
      }
    }
  }

  /**
   * Soft-delete a file: move it to trash and record in manifest.
   */
  move(opts: {
    path: string;
    reason: string;
    actor: string;
    fileType?: TrashFileType;
  }): TrashEntry {
    const absPath = resolve(opts.path);

    if (!existsSync(absPath)) {
      throw new Error(`File not found: ${absPath}`);
    }

    const id = this.allocateId();
    const now = new Date().toISOString();
    const datePrefix = now.slice(0, 10);
    const idSuffix = id.split("-")[1]; // "001" from "T-001"
    const subDir = `${datePrefix}-${idSuffix}`;
    const fileName = basename(absPath);

    const trashSubDir = resolve(this.filesDir, subDir);
    mkdirSync(trashSubDir, { recursive: true });

    const destPath = resolve(trashSubDir, fileName);

    // Cross-filesystem safe: try rename, fallback to copy+unlink
    try {
      const { renameSync } = require("node:fs") as typeof import("node:fs");
      renameSync(absPath, destPath);
    } catch {
      copyFileSync(absPath, destPath);
      unlinkSync(absPath);
    }

    const entry: TrashEntry = {
      id,
      trashedAt: now,
      actor: opts.actor,
      reason: opts.reason,
      originalPath: absPath,
      fileType: opts.fileType ?? "other",
      trashPath: `${subDir}/${fileName}`,
      status: "trashed",
    };

    const entries = this.readManifest();
    entries.push(entry);
    this.writeManifest(entries);

    return entry;
  }

  /**
   * List trash entries, optionally filtered.
   */
  list(filters?: {
    status?: TrashStatus;
    fileType?: TrashFileType;
    search?: string;
  }): TrashEntry[] {
    let entries = this.readManifest();

    if (filters?.status) {
      entries = entries.filter((e) => e.status === filters.status);
    }
    if (filters?.fileType) {
      entries = entries.filter((e) => e.fileType === filters.fileType);
    }
    if (filters?.search) {
      const q = filters.search.toLowerCase();
      entries = entries.filter(
        (e) =>
          e.id.toLowerCase().includes(q) ||
          e.originalPath.toLowerCase().includes(q) ||
          e.reason.toLowerCase().includes(q) ||
          e.actor.toLowerCase().includes(q)
      );
    }

    return entries;
  }

  /** Get a single entry by ID */
  get(id: string): TrashEntry | undefined {
    return this.readManifest().find((e) => e.id === id);
  }

  /**
   * Restore a trashed file to its original location.
   */
  restore(id: string, opts?: { force?: boolean; actor?: string }): TrashEntry {
    const entries = this.readManifest();
    const idx = entries.findIndex((e) => e.id === id);

    if (idx === -1) {
      throw new Error(`Trash entry not found: ${id}`);
    }

    const entry = entries[idx];

    if (entry.status !== "trashed") {
      throw new Error(`Cannot restore: ${id} has status "${entry.status}"`);
    }

    const trashFilePath = resolve(this.filesDir, entry.trashPath);

    if (!existsSync(trashFilePath)) {
      throw new Error(`Trashed file missing from disk: ${entry.trashPath}`);
    }

    // Check if original path already exists
    if (existsSync(entry.originalPath) && !opts?.force) {
      throw new Error(
        `Original path already exists: ${entry.originalPath}. Use --force to overwrite.`
      );
    }

    // Recreate parent directory if needed
    const parentDir = dirname(entry.originalPath);
    mkdirSync(parentDir, { recursive: true });

    // Move back: try rename, fallback to copy+unlink
    try {
      const { renameSync } = require("node:fs") as typeof import("node:fs");
      renameSync(trashFilePath, entry.originalPath);
    } catch {
      copyFileSync(trashFilePath, entry.originalPath);
      unlinkSync(trashFilePath);
    }

    // Update manifest
    const now = new Date().toISOString();
    entries[idx] = {
      ...entry,
      status: "restored",
      restoredAt: now,
    };
    this.writeManifest(entries);

    return entries[idx];
  }

  /**
   * Purge items older than N days. Returns purged entries.
   */
  purge(opts?: {
    days?: number;
    dryRun?: boolean;
    actor?: string;
  }): TrashEntry[] {
    const days = opts?.days ?? 30;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const entries = this.readManifest();
    const toPurge: TrashEntry[] = [];

    for (const entry of entries) {
      if (entry.status !== "trashed") continue;
      if (new Date(entry.trashedAt) <= cutoff) {
        toPurge.push(entry);
      }
    }

    if (opts?.dryRun || toPurge.length === 0) {
      return toPurge;
    }

    const now = new Date().toISOString();

    for (const entry of toPurge) {
      // Delete the file from trash
      const trashFilePath = resolve(this.filesDir, entry.trashPath);
      if (existsSync(trashFilePath)) {
        unlinkSync(trashFilePath);
      }

      // Remove empty subdirectory
      const subDir = resolve(this.filesDir, entry.trashPath.split("/")[0]);
      try {
        rmSync(subDir, { recursive: true });
      } catch {
        /* ignore if not empty or already gone */
      }

      // Update manifest entry
      const idx = entries.findIndex((e) => e.id === entry.id);
      if (idx !== -1) {
        entries[idx] = { ...entries[idx], status: "purged", purgedAt: now };
      }
    }

    this.writeManifest(entries);
    return toPurge;
  }
}
