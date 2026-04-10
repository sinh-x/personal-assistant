/** Skill entry for mode-level skill declarations */
export interface SkillEntry {
  name: string;
  /** How this skill is injected into the primer */
  'inject-as': 'global-skill' | 'shared-skill' | 'reference';
}

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
  skills?: SkillEntry[];
  /** Determines which standards modules are included in the primer; defaults to 'work' */
  mode_type?: 'housekeeping' | 'work' | 'interactive';
  /** Solo operator mode — team-manager does all work, no sub-agents; omits multi-agent deployment instructions */
  solo?: boolean;
  /** Per-mode model override — takes precedence over team-level model, but yields to explicit --team-model CLI flag */
  model?: 'haiku' | 'sonnet' | 'opus';
  /** Per-mode API provider — takes precedence over default 'anthropic', but yields to explicit --provider CLI flag */
  provider?: 'anthropic' | 'minimax';
  /**
   * Per-mode timeout override in seconds.
   * Takes precedence over team-level timeout, but yields to --timeout CLI flag and PA_MAX_RUNTIME env var.
   * Must be between 60 and 7200 seconds.
   */
  timeout?: number;
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
  /** Available deployment modes for this team */
  deploy_modes?: DeployMode[];
  /** Default mode to use when no --mode flag is provided */
  default_mode?: string;
  /** Team hierarchy definition */
  hierarchy?: Hierarchy;
  /**
   * Per-team timeout in seconds.
   * Takes precedence over the hardcoded default (2700s), but yields to --timeout CLI flag and PA_MAX_RUNTIME env var.
   * Must be between 60 and 7200 seconds.
   */
  timeout?: number;
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
  /** Agent-specific workflow instruction file (replaces skill) */
  instruction?: string;
  /**
   * @deprecated Use `instruction` instead. Kept for backwards compat during migration.
   */
  skill?: string;
  model?: 'haiku' | 'sonnet' | 'opus';
}

/** Session rating for agent self-evaluation, written to registry on completion */
export interface Rating {
  source: "agent" | "system" | "user";
  overall: number;
  productivity?: number;
  quality?: number;
  efficiency?: number;
  insight?: number;
}

/** Events written to the deployment registry SQLite */
export interface RegistryEvent {
  deployment_id: string;
  team: string;
  event: "started" | "pid" | "completed" | "crashed" | "amended";
  timestamp: string;
  pid?: number;
  status?: "success" | "partial" | "failed";
  summary?: string;
  log_file?: string;
  primer?: string;
  agents?: string[];
  models?: Record<string, string>;
  error?: string;
  exit_code?: number;
  ticket_id?: string;
  provider?: string;
  rating?: Rating;
  objective?: string;
  repo?: string;
  fallback?: boolean;
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
  ticket_id?: string;
  objective?: string;
  models?: Record<string, string>;
  provider?: string;
  repo?: string;
  fallback?: boolean;
}

/** Per-provider model tier overrides */
export interface ProviderModelTier {
  sonnet?: string;
  opus?: string;
  haiku?: string;
}

/** Provider-specific configuration for default provider/model fallbacks */
export interface ProviderDefaults {
  /** Default provider when no mode-level or CLI provider is specified */
  default_provider?: "anthropic" | "minimax";
  /** Default model tier when no mode-level or CLI model is specified */
  default_model?: "haiku" | "sonnet" | "opus";
  /** Per-provider model and endpoint overrides */
  providers?: {
    anthropic?: {
      base_url?: string;
      models?: ProviderModelTier;
    };
    minimax?: {
      base_url?: string;
      models?: ProviderModelTier;
    };
  };
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
  /** Minimax API key for --provider minimax deployments */
  minimax_api_key?: string;
  /** Provider and model defaults loaded from config.yaml */
  provider_defaults?: ProviderDefaults;
}
