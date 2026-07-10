import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { DataPaths } from "@dont-waste/core";
import type { MetricEvent } from "./metrics.js";

export type ProjectRow = { path: string; alias: string | null };
export type SessionRow = {
  id: string;
  agent: string | null;
  projectPath: string | null;
  startedAt: string | null;
  endedAt: string | null;
  metadata: Record<string, unknown>;
};
export type ImportRow = {
  source: string;
  importedAt: string;
  cursor: string | null;
  error: string | null;
  eventsImported: number;
};

export class TelemetryStore {
  readonly database: DatabaseSync;

  private constructor(database: DatabaseSync) { this.database = database; }

  static async open(paths: DataPaths): Promise<TelemetryStore> {
    await mkdir(path.dirname(paths.database), { recursive: true });
    const store = new TelemetryStore(new DatabaseSync(paths.database));
    store.migrate();
    return store;
  }

  private migrate(): void {
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS installations (
        id TEXT PRIMARY KEY, tool TEXT NOT NULL, version TEXT, channel TEXT,
        installed_at TEXT NOT NULL, os TEXT NOT NULL, result TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY, agent TEXT NOT NULL UNIQUE, config_path TEXT,
        version TEXT, detected_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS agent_integrations (
        id TEXT PRIMARY KEY, agent TEXT NOT NULL, tool TEXT NOT NULL,
        features_json TEXT NOT NULL, state TEXT NOT NULL, backup_id TEXT,
        UNIQUE(agent, tool)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, alias TEXT
      ) STRICT;
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, agent TEXT, project_id TEXT, started_at TEXT,
        ended_at TEXT, metadata_json TEXT NOT NULL DEFAULT '{}'
      ) STRICT;
      CREATE TABLE IF NOT EXISTS metric_events (
        id TEXT PRIMARY KEY, occurred_at TEXT NOT NULL, tool TEXT NOT NULL,
        metric_type TEXT NOT NULL, tokens_before REAL, tokens_after REAL,
        tokens_saved REAL, savings_percent REAL, cost_before REAL, cost_after REAL,
        evidence TEXT, confidence TEXT NOT NULL, overlap_key TEXT, source_depth INTEGER NOT NULL,
        project_path TEXT, agent_id TEXT, session_id TEXT, model TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS metric_events_occurred_at ON metric_events(occurred_at);
      CREATE TABLE IF NOT EXISTS metric_imports (
        id TEXT PRIMARY KEY, source TEXT NOT NULL, imported_at TEXT NOT NULL,
        cursor TEXT, error TEXT, events_imported INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS operations (
        id TEXT PRIMARY KEY, operation TEXT NOT NULL, created_at TEXT NOT NULL,
        plan_json TEXT NOT NULL, result TEXT NOT NULL, snapshot_id TEXT
      ) STRICT;
    `);
    // Older DBs created before model column — ignore if already present.
    try { this.database.exec("ALTER TABLE metric_events ADD COLUMN model TEXT"); } catch { /* exists */ }
  }

  insertEvents(events: MetricEvent[]): number {
    const statement = this.database.prepare(`
      INSERT OR IGNORE INTO metric_events (
        id, occurred_at, tool, metric_type, tokens_before, tokens_after, tokens_saved,
        savings_percent, cost_before, cost_after, evidence, confidence, overlap_key,
        source_depth, project_path, agent_id, session_id, model
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    let inserted = 0;
    this.database.exec("BEGIN");
    try {
      for (const event of events) {
        const changes = statement.run(
          event.id, event.occurredAt, event.tool, event.metricType, event.tokensBefore, event.tokensAfter,
          event.tokensSaved, event.tokensBefore && event.tokensSaved !== null ? event.tokensSaved / event.tokensBefore * 100 : null,
          event.costBefore ?? null, event.costAfter ?? null, event.evidence ?? null, event.confidence,
          event.overlapKey ?? null, event.sourceDepth, event.projectPath ?? null, event.agentId ?? null, event.sessionId ?? null,
          event.model ?? null,
        );
        inserted += Number(changes.changes);
        if (event.projectPath) this.upsertProject(event.projectPath);
        if (event.sessionId) {
          this.upsertSession({
            id: event.sessionId,
            agent: event.agentId,
            projectPath: event.projectPath,
            startedAt: event.occurredAt,
            metadata: event.model ? { model: event.model } : {},
          });
        }
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return inserted;
  }

  listEvents(limit = 500): MetricEvent[] {
    const rows = this.database.prepare(`SELECT * FROM metric_events ORDER BY occurred_at DESC LIMIT ?`).all(limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id), occurredAt: String(row.occurred_at), tool: row.tool as MetricEvent["tool"], metricType: row.metric_type as MetricEvent["metricType"],
      tokensBefore: row.tokens_before as number | null, tokensAfter: row.tokens_after as number | null, tokensSaved: row.tokens_saved as number | null,
      confidence: row.confidence as MetricEvent["confidence"], sourceDepth: Number(row.source_depth),
      overlapKey: (row.overlap_key as string | null) ?? undefined, projectPath: (row.project_path as string | null) ?? undefined,
      agentId: (row.agent_id as string | null) ?? undefined, sessionId: (row.session_id as string | null) ?? undefined,
      model: (row.model as string | null) ?? undefined,
      evidence: (row.evidence as string | null) ?? undefined, costBefore: (row.cost_before as number | null) ?? undefined,
      costAfter: (row.cost_after as number | null) ?? undefined,
    }));
  }

  recordImport(source: string, eventsImported: number, error?: string, cursor?: string): void {
    this.database.prepare(`INSERT INTO metric_imports (id, source, imported_at, cursor, error, events_imported) VALUES (?, ?, ?, ?, ?, ?)`).run(
      crypto.randomUUID(), source, new Date().toISOString(), cursor ?? null, error ?? null, eventsImported,
    );
  }

  latestImportCursor(source: string): string | undefined {
    const row = this.database.prepare(`SELECT cursor FROM metric_imports WHERE source = ? AND error IS NULL AND cursor IS NOT NULL ORDER BY imported_at DESC LIMIT 1`).get(source) as { cursor?: string } | undefined;
    return row?.cursor;
  }

  upsertProject(projectPath: string, alias?: string): void {
    this.database.prepare(`INSERT INTO projects (id, path, alias) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET alias = COALESCE(excluded.alias, projects.alias)`).run(
      crypto.randomUUID(), projectPath, alias ?? null,
    );
  }

  listProjects(): ProjectRow[] {
    return this.database.prepare(`SELECT path, alias FROM projects ORDER BY path`).all().map((row) => {
      const typed = row as Record<string, unknown>;
      return { path: String(typed.path), alias: (typed.alias as string | null) ?? null };
    });
  }

  upsertSession(input: {
    id: string;
    agent?: string | undefined;
    projectPath?: string | undefined;
    startedAt?: string | undefined;
    endedAt?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
  }): void {
    let projectId: string | null = null;
    if (input.projectPath) {
      this.upsertProject(input.projectPath);
      const row = this.database.prepare(`SELECT id FROM projects WHERE path = ?`).get(input.projectPath) as { id?: string } | undefined;
      projectId = row?.id ?? null;
    }
    this.database.prepare(`
      INSERT INTO sessions (id, agent, project_id, started_at, ended_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        agent = COALESCE(excluded.agent, sessions.agent),
        project_id = COALESCE(excluded.project_id, sessions.project_id),
        started_at = COALESCE(sessions.started_at, excluded.started_at),
        ended_at = COALESCE(excluded.ended_at, sessions.ended_at),
        metadata_json = excluded.metadata_json
    `).run(
      input.id,
      input.agent ?? null,
      projectId,
      input.startedAt ?? null,
      input.endedAt ?? null,
      JSON.stringify(input.metadata ?? {}),
    );
  }

  listSessions(limit = 100): SessionRow[] {
    const rows = this.database.prepare(`
      SELECT s.id, s.agent, p.path AS project_path, s.started_at, s.ended_at, s.metadata_json
      FROM sessions s
      LEFT JOIN projects p ON p.id = s.project_id
      ORDER BY COALESCE(s.started_at, '') DESC
      LIMIT ?
    `).all(limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      agent: (row.agent as string | null) ?? null,
      projectPath: (row.project_path as string | null) ?? null,
      startedAt: (row.started_at as string | null) ?? null,
      endedAt: (row.ended_at as string | null) ?? null,
      metadata: (() => {
        try { return JSON.parse(String(row.metadata_json || "{}")) as Record<string, unknown>; }
        catch { return {}; }
      })(),
    }));
  }

  recordInstallation(tool: string, version: string | undefined, channel: string, result: "succeeded" | "failed"): void {
    this.database.prepare(`INSERT INTO installations (id, tool, version, channel, installed_at, os, result) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      crypto.randomUUID(), tool, version ?? null, channel, new Date().toISOString(), process.platform, result,
    );
  }

  latestInstallation(tool: string): { tool: string; version: string | null; channel: string; installedAt: string; result: string } | undefined {
    const row = this.database.prepare(`SELECT tool, version, channel, installed_at, result FROM installations WHERE tool = ? AND result = 'succeeded' ORDER BY installed_at DESC LIMIT 1`).get(tool) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      tool: String(row.tool),
      version: (row.version as string | null) ?? null,
      channel: String(row.channel),
      installedAt: String(row.installed_at),
      result: String(row.result),
    };
  }

  recordAgent(agent: string, configPath: string | undefined, version: string | undefined): void {
    this.database.prepare(`INSERT INTO agents (id, agent, config_path, version, detected_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(agent) DO UPDATE SET config_path = excluded.config_path, version = excluded.version, detected_at = excluded.detected_at`).run(
      crypto.randomUUID(), agent, configPath ?? null, version ?? null, new Date().toISOString(),
    );
  }

  recordIntegration(agent: string, tool: string, features: Record<string, boolean>, state: "active" | "pending" | "failed", backupId: string | undefined): void {
    this.database.prepare(`INSERT INTO agent_integrations (id, agent, tool, features_json, state, backup_id) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(agent, tool) DO UPDATE SET features_json = excluded.features_json, state = excluded.state, backup_id = excluded.backup_id`).run(
      crypto.randomUUID(), agent, tool, JSON.stringify(features), state, backupId ?? null,
    );
  }

  recordOperation(id: string, operation: string, plan: unknown, result: string, snapshotId: string | undefined): void {
    this.database.prepare(`INSERT OR REPLACE INTO operations (id, operation, created_at, plan_json, result, snapshot_id) VALUES (?, ?, ?, ?, ?, ?)`).run(
      id, operation, new Date().toISOString(), JSON.stringify(plan), result, snapshotId ?? null,
    );
  }

  recentImports(limit = 20): ImportRow[] {
    return this.database.prepare(`SELECT source, imported_at, cursor, error, events_imported FROM metric_imports ORDER BY imported_at DESC LIMIT ?`).all(limit).map((row) => {
      const typed = row as Record<string, unknown>;
      return {
        source: String(typed.source),
        importedAt: String(typed.imported_at),
        cursor: (typed.cursor as string | null) ?? null,
        error: typed.error as string | null,
        eventsImported: Number(typed.events_imported),
      };
    });
  }

  close(): void { this.database.close(); }
}
