import { BulletinStore } from "./store.js";
import type { Bulletin } from "./types.js";

export interface GuardResult {
  blocked: boolean;
  /** The first blocking bulletin, if any */
  bulletin?: Bulletin;
}

/**
 * Check whether a team is blocked by any active bulletin.
 *
 * Logic:
 *   - If bulletin.block === "all" and teamName is NOT in bulletin.except → blocked
 *   - If bulletin.block is a string[] containing teamName and teamName is NOT in bulletin.except → blocked
 *   - Otherwise → not blocked by this bulletin
 *
 * Returns immediately on first blocking bulletin found.
 */
export function isTeamBlocked(teamName: string): GuardResult {
  let store: BulletinStore;
  try {
    store = new BulletinStore();
  } catch {
    // If bulletins dir can't be created/read, proceed without blocking
    return { blocked: false };
  }

  let bulletins: Bulletin[];
  try {
    bulletins = store.readActive();
  } catch {
    return { blocked: false };
  }

  for (const bulletin of bulletins) {
    if (bulletin.except.includes(teamName)) continue;

    if (bulletin.block === "all") {
      return { blocked: true, bulletin };
    }

    if (Array.isArray(bulletin.block) && bulletin.block.includes(teamName)) {
      return { blocked: true, bulletin };
    }
  }

  return { blocked: false };
}
