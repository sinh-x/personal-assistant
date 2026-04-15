/**
 * Health check types for `pa health` command.
 * Defines the data structures for findings, category results, and health reports.
 */

/** Severity level for a health finding */
export type FindingSeverity = "pass" | "warn" | "fail";

/** Health category names */
export type HealthCategory =
  | "deployments"
  | "agents"
  | "tickets"
  | "compliance"
  | "schedules"
  | "infrastructure";

/** A single health check finding */
export interface HealthFinding {
  /** Severity: pass, warn, or fail */
  severity: FindingSeverity;
  /** Category this finding belongs to */
  category: HealthCategory;
  /** Human-readable message describing the finding */
  message: string;
  /** Optional additional details (IDs, counts, etc.) */
  details?: string;
}

/** Result for a single health category */
export interface CategoryResult {
  /** Category name */
  name: HealthCategory;
  /** Score 0-100 for this category */
  score: number;
  /** All findings for this category */
  findings: HealthFinding[];
  /** Optional stats specific to this category */
  stats?: Record<string, number | string | boolean>;
}

/** Time window for health analysis */
export interface HealthWindow {
  /** Start of analysis window (ISO timestamp) */
  since: string;
  /** End of analysis window (ISO timestamp) */
  until: string;
}

/** Health configuration from health.yaml */
export interface HealthConfig {
  /** Category weights (must sum to 100) */
  weights: Partial<Record<HealthCategory, number>>;
  /** Score thresholds */
  thresholds: {
    healthy: number;
    warning: number;
  };
}

/** Complete health report */
export interface HealthReport {
  /** Overall health score 0-100 */
  overallScore: number;
  /** Score label: healthy, warning, or unhealthy */
  scoreLabel: "healthy" | "warning" | "unhealthy";
  /** Per-category results */
  categories: CategoryResult[];
  /** Analysis time window */
  window: HealthWindow;
  /** When this report was generated */
  generatedAt: string;
}

/** Snapshot stored in health_snapshots table */
export interface HealthSnapshot {
  id: number;
  timestamp: string;
  overallScore: number;
  windowSince: string;
  windowUntil: string;
  categories: CategoryResult[];
}

/** Activity event from activity.jsonl */
export interface ActivityEvent {
  ts: string;
  deploy_id: string;
  agent: string;
  agent_type?: string;
  event: string;
  data: Record<string, unknown>;
}

/** Parsed activity log result */
export interface ActivityAnalysis {
  deployId: string;
  totalCalls: number;
  failures: number;
  errorRate: number;
  errorLoops: Array<{
    agent: string;
    consecutiveCount: number;
    firstTs: string;
  }>;
}
