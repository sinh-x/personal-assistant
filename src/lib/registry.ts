import { getDb } from "./registry-db.js";
import type { RegistryEvent, DeploymentStatus } from "./types.js";

/**
 * Validate a registry event has required fields.
 * Throws if required fields are missing.
 */
export function validateRegistryEvent(event: RegistryEvent): void {
  if (!event.deployment_id) {
    throw new Error("Registry event missing required field: deployment_id");
  }
  if (!event.team) {
    throw new Error("Registry event missing required field: team");
  }
  if (!event.event) {
    throw new Error("Registry event missing required field: event");
  }
  if (!event.timestamp) {
    throw new Error("Registry event missing required field: timestamp");
  }
}

/**
 * Read all events from the registry SQLite database.
 * Queries registry_events table ordered by id.
 */
export function readRegistry(): RegistryEvent[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM registry_events ORDER BY id")
    .all() as Record<string, unknown>[];

  return rows.map((row) => {
    return {
      deployment_id: row.deployment_id as string,
      team: row.team as string,
      event: row.event as RegistryEvent["event"],
      timestamp: row.timestamp as string,
      pid: row.pid as number | undefined,
      status: row.status as RegistryEvent["status"],
      summary: row.summary as string | undefined,
      log_file: row.log_file as string | undefined,
      primer: row.primer as string | undefined,
      agents: row.agents ? (JSON.parse(row.agents as string) as string[]) : undefined,
      models: row.models
        ? (JSON.parse(row.models as string) as Record<string, string>)
        : undefined,
      error: row.error as string | undefined,
      exit_code: row.exit_code as number | undefined,
      ticket_id: row.ticket_id as string | undefined,
      provider: row.provider as string | undefined,
      rating: row.rating ? (JSON.parse(row.rating as string) as RegistryEvent["rating"]) : undefined,
      objective: row.objective as string | undefined,
      repo: row.repo as string | undefined,
    };
  });
}

/**
 * Append an event to the registry SQLite database.
 * Validates the event before appending.
 * Handles both registry_events INSERT and deployments UPSERT.
 */
export function appendRegistryEvent(event: RegistryEvent): void {
  validateRegistryEvent(event);
  const db = getDb();

  // Serialize complex fields to JSON strings for storage
  const agentsJson = event.agents ? JSON.stringify(event.agents) : null;
  const modelsJson = event.models ? JSON.stringify(event.models) : null;
  const ratingJson = event.rating ? JSON.stringify(event.rating) : null;

  // INSERT INTO registry_events
  db.prepare(`
    INSERT INTO registry_events (
      deployment_id, team, event, timestamp, pid, status, summary,
      log_file, primer, agents, models, error, exit_code,
      ticket_id, provider, rating, objective, repo
    ) VALUES (
      @deployment_id, @team, @event, @timestamp, @pid, @status, @summary,
      @log_file, @primer, @agents, @models, @error, @exit_code,
      @ticket_id, @provider, @rating, @objective, @repo
    )
  `).run({
    deployment_id: event.deployment_id,
    team: event.team,
    event: event.event,
    timestamp: event.timestamp,
    pid: event.pid ?? null,
    status: event.status ?? null,
    summary: event.summary ?? null,
    log_file: event.log_file ?? null,
    primer: event.primer ?? null,
    agents: agentsJson,
    models: modelsJson,
    error: event.error ?? null,
    exit_code: event.exit_code ?? null,
    ticket_id: event.ticket_id ?? null,
    provider: event.provider ?? null,
    rating: ratingJson,
    objective: event.objective ?? null,
    repo: event.repo ?? null,
  });

  // UPSERT INTO deployments materialized view
  upsertDeployment(db, event);
}

/**
 * Upsert a deployment row based on the event type.
 * started: INSERT new row
 * pid: UPDATE pid
 * completed: UPDATE status, completed_at, summary, log_file, rating, exit_code
 * crashed: UPDATE status=crashed, completed_at, error, exit_code
 */
function upsertDeployment(db: ReturnType<typeof getDb>, event: RegistryEvent): void {
  switch (event.event) {
    case "started":
      db.prepare(`
        INSERT INTO deployments (
          deployment_id, team, status, started_at, pid, primer,
          agents, models, ticket_id, objective, repo, provider
        ) VALUES (
          @deployment_id, @team, 'running', @started_at, @pid, @primer,
          @agents, @models, @ticket_id, @objective, @repo, @provider
        )
      `).run({
        deployment_id: event.deployment_id,
        team: event.team,
        started_at: event.timestamp,
        pid: event.pid ?? null,
        primer: event.primer ?? null,
        agents: event.agents ? JSON.stringify(event.agents) : null,
        models: event.models ? JSON.stringify(event.models) : null,
        ticket_id: event.ticket_id ?? null,
        objective: event.objective ?? null,
        repo: event.repo ?? null,
        provider: event.provider ?? null,
      });
      break;

    case "pid":
      db.prepare(`
        UPDATE deployments SET pid = @pid WHERE deployment_id = @deployment_id
      `).run({
        deployment_id: event.deployment_id,
        pid: event.pid,
      });
      break;

    case "completed":
      db.prepare(`
        UPDATE deployments SET
          status = @status,
          completed_at = @completed_at,
          summary = @summary,
          log_file = @log_file,
          rating = @rating,
          exit_code = @exit_code
        WHERE deployment_id = @deployment_id
      `).run({
        deployment_id: event.deployment_id,
        status: event.status ?? "success",
        completed_at: event.timestamp,
        summary: event.summary ?? null,
        log_file: event.log_file ?? null,
        rating: event.rating ? JSON.stringify(event.rating) : null,
        exit_code: event.exit_code ?? null,
      });
      break;

    case "crashed":
      db.prepare(`
        UPDATE deployments SET
          status = 'crashed',
          completed_at = @completed_at,
          error = @error,
          exit_code = @exit_code
        WHERE deployment_id = @deployment_id
      `).run({
        deployment_id: event.deployment_id,
        completed_at: event.timestamp,
        error: event.error ?? null,
        exit_code: event.exit_code ?? null,
      });
      break;

    case "amended":
      db.prepare(`
        UPDATE deployments SET
          summary = COALESCE(summary, '') || '\n[AMENDED] ' || @summary
        WHERE deployment_id = @deployment_id
      `).run({
        deployment_id: event.deployment_id,
        summary: event.summary ?? "",
      });
      break;
  }
}

/**
 * Get events for a specific deployment ID.
 */
export function getDeploymentEvents(deployId: string): RegistryEvent[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM registry_events WHERE deployment_id = ? ORDER BY id")
    .all(deployId) as Record<string, unknown>[];

  return rows.map((row) => {
    return {
      deployment_id: row.deployment_id as string,
      team: row.team as string,
      event: row.event as RegistryEvent["event"],
      timestamp: row.timestamp as string,
      pid: row.pid as number | undefined,
      status: row.status as RegistryEvent["status"],
      summary: row.summary as string | undefined,
      log_file: row.log_file as string | undefined,
      primer: row.primer as string | undefined,
      agents: row.agents ? (JSON.parse(row.agents as string) as string[]) : undefined,
      models: row.models
        ? (JSON.parse(row.models as string) as Record<string, string>)
        : undefined,
      error: row.error as string | undefined,
      exit_code: row.exit_code as number | undefined,
      ticket_id: row.ticket_id as string | undefined,
      provider: row.provider as string | undefined,
      rating: row.rating ? (JSON.parse(row.rating as string) as RegistryEvent["rating"]) : undefined,
      objective: row.objective as string | undefined,
      repo: row.repo as string | undefined,
    };
  });
}

/**
 * Get the latest event for each deployment, grouped by deploy_id.
 */
export function getLatestDeployments(): Map<string, RegistryEvent[]> {
  const events = readRegistry();
  const grouped = new Map<string, RegistryEvent[]>();

  for (const event of events) {
    const existing = grouped.get(event.deployment_id) ?? [];
    existing.push(event);
    grouped.set(event.deployment_id, existing);
  }

  return grouped;
}

/**
 * Compute deployment statuses from a list of registry events.
 * Returns the computed status for each unique deployment.
 * Note: This function is kept for backwards compatibility when computing from partial events.
 * For full registry queries, use queryDeploymentStatuses() instead.
 */
export function computeDeploymentStatuses(events: RegistryEvent[]): DeploymentStatus[] {
  const grouped = new Map<string, RegistryEvent[]>();
  for (const ev of events) {
    const existing = grouped.get(ev.deployment_id) ?? [];
    existing.push(ev);
    grouped.set(ev.deployment_id, existing);
  }

  const statuses: DeploymentStatus[] = [];
  for (const [deployId, evs] of grouped) {
    const started = evs.find((e) => e.event === "started");
    const completed = evs.find((e) => e.event === "completed");
    const crashed = evs.find((e) => e.event === "crashed");
    const pidEv = evs.find((e) => e.event === "pid");

    let status: DeploymentStatus["status"] = "unknown";
    if (completed) {
      status = (completed.status as DeploymentStatus["status"]) ?? "success";
    } else if (crashed) {
      status = "crashed";
    } else if (started) {
      status = "running";
    }

    statuses.push({
      deploy_id: deployId,
      team: started?.team ?? evs[0]?.team ?? "",
      status,
      started_at: started?.timestamp ?? evs[0]?.timestamp ?? "",
      completed_at: completed?.timestamp ?? crashed?.timestamp,
      pid: pidEv?.pid,
      agents: started?.agents ?? [],
      summary: completed?.summary,
      log_file: started?.log_file,
      primer: started?.primer,
      ticket_id: started?.ticket_id,
      objective: started?.objective,
      models: started?.models,
      provider: started?.provider,
      repo: started?.repo,
    });
  }

  // Sort by started_at descending (newest first)
  statuses.sort((a, b) => b.started_at.localeCompare(a.started_at));
  return statuses;
}

/**
 * Query deployment statuses directly from the deployments table.
 * Returns all deployments ordered by started_at descending.
 */
export function queryDeploymentStatuses(): DeploymentStatus[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM deployments ORDER BY started_at DESC")
    .all() as Record<string, unknown>[];

  return rows.map((row) => ({
    deploy_id: row.deployment_id as string,
    team: row.team as string,
    status: row.status as DeploymentStatus["status"],
    started_at: row.started_at as string,
    completed_at: row.completed_at as string | undefined,
    pid: row.pid as number | undefined,
    agents: row.agents ? (JSON.parse(row.agents as string) as string[]) : [],
    summary: row.summary as string | undefined,
    log_file: row.log_file as string | undefined,
    primer: row.primer as string | undefined,
    ticket_id: row.ticket_id as string | undefined,
    objective: row.objective as string | undefined,
    models: row.models
      ? (JSON.parse(row.models as string) as Record<string, string>)
      : undefined,
    provider: row.provider as string | undefined,
    repo: row.repo as string | undefined,
  }));
}

/**
 * Query a single deployment status from the deployments table.
 */
export function queryDeploymentStatus(deployId: string): DeploymentStatus | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM deployments WHERE deployment_id = ?")
    .get(deployId) as Record<string, unknown> | undefined;

  if (!row) return null;

  return {
    deploy_id: row.deployment_id as string,
    team: row.team as string,
    status: row.status as DeploymentStatus["status"],
    started_at: row.started_at as string,
    completed_at: row.completed_at as string | undefined,
    pid: row.pid as number | undefined,
    agents: row.agents ? (JSON.parse(row.agents as string) as string[]) : [],
    summary: row.summary as string | undefined,
    log_file: row.log_file as string | undefined,
    primer: row.primer as string | undefined,
    ticket_id: row.ticket_id as string | undefined,
    objective: row.objective as string | undefined,
    models: row.models
      ? (JSON.parse(row.models as string) as Record<string, string>)
      : undefined,
    provider: row.provider as string | undefined,
    repo: row.repo as string | undefined,
  };
}
