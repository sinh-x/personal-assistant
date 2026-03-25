export type TrashFileType = "skill" | "team" | "objective" | "mode" | "other";

export type TrashStatus = "trashed" | "restored" | "purged";

export interface TrashEntry {
  id: string; // T-001, T-002
  trashedAt: string; // ISO timestamp
  actor: string; // who trashed it
  reason: string; // why
  originalPath: string; // absolute original location
  fileType: TrashFileType;
  trashPath: string; // relative to trash/files/
  status: TrashStatus;
  restoredAt?: string;
  purgedAt?: string;
}
