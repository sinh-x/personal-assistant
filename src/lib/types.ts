/** Runtime to use for agent invocation */
export type Runtime = "claude" | "opencode";

/** Mode-specific deployment configuration within a team */
export interface DeployMode {
  id: string;
  label: string;
  phone_visible?: boolean;
  /** Path to a mode-specific objective markdown file (relative to PA_CONFIG or PA_HOME) */
  objective?: string;
  /** Subset of agent names to include in this mode; empty array = team-manager only; omitted = all agents */
  agents?: string[];
  /** Skills to surface in this mode's primer */
  skills?: string[];
  /** Determines which standards modules are included in the primer; defaults to 'work' */
  mode_type?: 'housekeeping' | 'work' | 'interactive';
  /** Solo operator mode — team-manager does all work, no sub-agents; omits multi-agent deployment instructions */
  solo?: boolean;
  /**
   * Additional global skill/policy docs to inject for this mode.
   * Paths relative to PA_CONFIG or PA_HOME.
   * Merged with TeamConfig.global_docs and injected after standards modules as <global-skill> blocks.
   */
  global_docs?: string[];
}

/** Hierarchy member entry (team-manager or an agent in the hierarchy block) */
export interface HierarchyMember {
  role?: string;
  participates_in?: 'all' | string[];
}

/** Team hierarchy definition — who does what and in which modes */
export interface Hierarchy {
  'team-manager'?: HierarchyMember;
  agents?: Array<{ name: string } & HierarchyMember>;
}

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
  model?: 'haiku' | 'sonnet' | 'opus';
  /** Runtime to use for this team (overrides global config; CLI --runtime overrides this) */
  runtime?: Runtime;
  /** Available deployment modes for this team */
  deploy_modes?: DeployMode[];
  /** Default mode to use when no --mode flag is provided */
  default_mode?: string;
  /** Team hierarchy definition */
  hierarchy?: Hierarchy;
  /**
   * Global docs injected for all modes of this team (team-level default).
   * Merged with per-mode global_docs. Useful for kanban-aware teams that need
   * workflow/policy docs across all their work modes.
   */
  global_docs?: string[];
}

/** Agent definition within a team */
export interface Agent {
  name: string;
  role: string;
  skill: string;
  model?: 'haiku' | 'sonnet' | 'opus';
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
  primer?: string;
  agents?: string[];
  models?: Record<string, string>;
  runtime?: Runtime;
  error?: string;
  exit_code?: number;
  ticket_id?: string;
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
  primer?: string;
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
  /** Default runtime for all deployments (CLI --runtime overrides) */
  runtime?: Runtime;
}
