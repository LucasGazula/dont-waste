import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { DataPaths } from "@dont-waste/core";
import type { MetricEvent } from "./metrics.js";

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
        project_path TEXT, agent_id TEXT, session_id TEXT
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
  }

  insertEvents(events: MetricEvent[]): number {
    const statement = this.database.prepare(`
      INSERT OR IGNORE INTO metric_events (
        id, occurred_at, tool, metric_type, tokens_before, tokens_after, tokens_saved,
        savings_percent, cost_before, cost_after, evidence, confidence, overlap_key,
        source_depth, project_path, agent_id, session_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        );
        inserted += Number(changes.changes);
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
      evidence: (row.evidence as string | null) ?? undefined, costBefore: (row.cost_before as number | null) ?? undefined,
      costAfter: (row.cost_after as number | null) ?? undefined,
    }));
  }

  recordImport(source: string, eventsImported: number, error?: string): void {
    this.database.prepare(`INSERT INTO metric_imports (id, source, imported_at, error, events_imported) VALUES (?, ?, ?, ?, ?)`).run(
      crypto.randomUUID(), source, new Date().toISOString(), error ?? null, eventsImported,
    );
  }

  recordInstallation(tool: string, version: string | undefined, channel: string, result: "succeeded" | "failed"): void {
    this.database.prepare(`INSERT INTO installations (id, tool, version, channel, installed_at, os, result) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      crypto.randomUUID(), tool, version ?? null, channel, new Date().toISOString(), process.platform, result,
    );
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

  recentImports(limit = 20): Array<{ source: string; importedAt: string; error: string | null; eventsImported: number }> {
    return this.database.prepare(`SELECT source, imported_at, error, events_imported FROM metric_imports ORDER BY imported_at DESC LIMIT ?`).all(limit).map((row) => {
      const typed = row as Record<string, unknown>;
      return { source: String(typed.source), importedAt: String(typed.imported_at), error: typed.error as string | null, eventsImported: Number(typed.events_imported) };
    });
  }

  close(): void { this.database.close(); }
}
