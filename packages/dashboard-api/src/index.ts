import { access } from "node:fs/promises";
import { createAdapters } from "@dont-waste/adapters";
import { agents, capabilities, upstream } from "@dont-waste/catalog";
import { readConfig, type DataPaths } from "@dont-waste/core";
import { TelemetryStore } from "@dont-waste/telemetry";
import fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { dashboardOverview } from "./overview.js";

export { dashboardOverview } from "./overview.js";

export type DashboardServer = { app: FastifyInstance; url: string; close(): Promise<void> };
export type DashboardApp = { app: FastifyInstance; close(): Promise<void> };

async function existingDirectory(directory: string | undefined): Promise<string | undefined> {
  if (!directory) return undefined;
  try { await access(directory); return directory; } catch { return undefined; }
}

export async function createDashboardApp(paths: DataPaths, options: { staticDir?: string | undefined } = {}): Promise<DashboardApp> {
  const app = fastify({ logger: false });
  const store = await TelemetryStore.open(paths);
  const staticDir = await existingDirectory(options.staticDir);
  if (staticDir) await app.register(fastifyStatic, { root: staticDir, wildcard: false });

  app.get("/api/overview", async () => dashboardOverview(await readConfig(paths), store.listEvents()));
  app.get("/api/events", async (request) => {
    const query = request.query as { limit?: string };
    const parsed = Number(query.limit);
    const limit = Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 1000) : 500;
    return { events: store.listEvents(limit) };
  });
  app.get("/api/imports", async () => ({ imports: store.recentImports() }));
  app.get("/api/config", async () => {
    const config = await readConfig(paths);
    return {
      profile: config.profile,
      updateChannel: config.updateChannel,
      integrations: config.integrations,
      projects: config.projects.map((project) => ({ alias: project.alias ?? "Local project", path: config.displayProjectPaths ? project.path : undefined })),
    };
  });
  app.get("/api/tools", async () => ({ tools: upstream, agents, capabilities }));
  app.get("/api/health", async () => {
    const config = await readConfig(paths);
    const selectedAgents = Object.keys(config.integrations) as (typeof agents)[number]["id"][];
    const context = { platform: process.platform, home: process.env.HOME ?? process.env.USERPROFILE ?? "", selectedAgents, dryRun: true } as const;
    const adapters = createAdapters();
    const tools = await Promise.all(Object.values(adapters).map(async (adapter) => ({ tool: adapter.id, detection: await adapter.detect(context), checks: await adapter.verify({ mode: "full", features: {} }, context) })));
    return { tools };
  });
  if (!staticDir) {
    app.get("/", async (_request, reply) => {
      return reply.type("text/html").send("<!doctype html><title>Don't Waste</title><main><h1>Don't Waste dashboard API</h1><p>Build the dashboard package to serve the local SPA.</p></main>");
    });
  }

  return { app, close: async () => { store.close(); await app.close(); } };
}

export async function createDashboardServer(paths: DataPaths, options: { port?: number | undefined; staticDir?: string | undefined; host?: string | undefined } = {}): Promise<DashboardServer> {
  const dashboard = await createDashboardApp(paths, options);
  const address = await dashboard.app.listen({ host: options.host ?? "127.0.0.1", port: options.port ?? 0 });
  return { ...dashboard, url: address };
}
