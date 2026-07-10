import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getDataPaths } from "@dont-waste/core";
import { createDashboardServer } from "../src/index.js";

const servers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  while (servers.length) await servers.pop()!.close();
  delete process.env.DONT_WASTE_DATA_DIR;
});

describe("createDashboardServer", () => {
  it("starts with SPA assets without conflicting on GET /", async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "dont-waste-api-"));
    process.env.DONT_WASTE_DATA_DIR = dataDir;
    const staticDir = await mkdtemp(path.join(os.tmpdir(), "dont-waste-spa-"));
    await writeFile(path.join(staticDir, "index.html"), "<!doctype html><title>spa</title>");
    const server = await createDashboardServer(getDataPaths(), { port: 0, staticDir });
    servers.push(server);
    const home = await fetch(server.url);
    expect(home.status).toBe(200);
    expect(await home.text()).toContain("spa");
    const overview = await fetch(`${server.url}/api/overview`);
    expect(overview.status).toBe(200);
    expect(await overview.json()).toHaveProperty("summary");
  }, 30_000);

  it("serves the API-only page when SPA assets are missing", async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "dont-waste-api-"));
    process.env.DONT_WASTE_DATA_DIR = dataDir;
    const missing = path.join(dataDir, "no-spa");
    await mkdir(dataDir, { recursive: true });
    const server = await createDashboardServer(getDataPaths(), { port: 0, staticDir: missing });
    servers.push(server);
    const home = await fetch(server.url);
    expect(home.status).toBe(200);
    expect(await home.text()).toContain("dashboard API");
  }, 30_000);

  it("accepts a relative staticDir by resolving it to an absolute path", async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "dont-waste-api-"));
    process.env.DONT_WASTE_DATA_DIR = dataDir;
    const relativeRoot = await mkdtemp(path.join(os.tmpdir(), "dont-waste-rel-"));
    const nested = path.join(relativeRoot, "spa");
    await mkdir(nested);
    await writeFile(path.join(nested, "index.html"), "<!doctype html><title>rel</title>");
    const previous = process.cwd();
    process.chdir(relativeRoot);
    try {
      const server = await createDashboardServer(getDataPaths(), { port: 0, staticDir: "spa" });
      servers.push(server);
      const home = await fetch(server.url);
      expect(home.status).toBe(200);
      expect(await home.text()).toContain("rel");
    } finally {
      process.chdir(previous);
    }
  }, 30_000);
});
