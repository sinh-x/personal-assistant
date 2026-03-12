/** Team configuration from YAML files */
export interface TeamConfig {
  name: string;
  description: string;
  context?: {
    organization?: string;
    notes?: string;
  };
  variables?: Record<string, string>;
  agents: Agent[];
  objective: string;
}

/** Agent definition within a team */
export interface Agent {
  name: string;
  role: string;
  skill: string;
}

/** Events written to the deployment registry JSONL */
export interface RegistryEvent {
  deployment_id: string;
  team: string;
  event: "started" | "pid" | "completed" | "crashed";
  timestamp: string;
  pid?: number;
  status?: "success" | "partial" | "failed";
  summary?: string;
  log_file?: string;
  primer_file?: string;
  agents?: string;
  error?: string;
}

/** Computed deployment status from registry events */
export interface DeploymentStatus {
  deploy_id: string;
  team: string;
  status:
    | "running"
    | "success"
    | "partial"
    | "failed"
    | "crashed"
    | "dead"
    | "unknown";
  started_at: string;
  completed_at?: string;
  pid?: number;
  agents: string[];
  summary?: string;
  log_file?: string;
  primer_file?: string;
}

/** PA configuration paths */
export interface PAConfig {
  /** teams/, skills/ location (user overrides) */
  configDir: string;
  /** primers/, logs/ location */
  dataDir: string;
  /** PA_HOME (read-only install, share/) */
  homeDir: string;
  /** PA_BIN (wrapped binaries) */
  binDir: string;
}
