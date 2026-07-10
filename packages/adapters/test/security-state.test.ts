import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultConfig, getDataPaths, writeConfig } from "@dont-waste/core";
import { CavemanAdapter } from "../src/caveman.js";
import { configuredToolsFromConfig } from "../src/config-tools.js";
import { unregisterHeadroomMcp, registerHeadroomMcp, headroomMcpSpec } from "../src/mcp.js";
import { PonytailAdapter } from "../src/ponytail.js";

const previousHome = process.env.HOME;
const previousData = process.env.DONT_WASTE_DATA_DIR;

afterEach(() => {
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  if (previousData === undefined) delete process.env.DONT_WASTE_DATA_DIR;
  else process.env.DONT_WASTE_DATA_DIR = previousData;
});

describe("phase 0/1 security regressions", () => {
  it("does not treat Node presence as Caveman/Ponytail installed", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "dont-waste-detect-"));
    process.env.HOME = home;
    const caveman = await new CavemanAdapter().detect({ platform: "linux", home, selectedAgents: [], dryRun: true });
    const ponytail = await new PonytailAdapter().detect({ platform: "linux", home, selectedAgents: [], dryRun: true });
    expect(caveman.detected).toBe(false);
    expect(ponytail.detected).toBe(false);
  });

  it("detects Caveman/Ponytail from markers/config under a temp HOME", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "dont-waste-detect-yes-"));
    await mkdir(path.join(home, ".claude"), { recursive: true });
    await writeFile(path.join(home, ".claude", ".caveman-active"), "full\n", "utf8");
    await mkdir(path.join(home, ".config", "ponytail"), { recursive: true });
    await writeFile(path.join(home, ".config", "ponytail", "config.json"), JSON.stringify({ defaultMode: "full" }), "utf8");
    const caveman = await new CavemanAdapter().detect({ platform: "linux", home, selectedAgents: ["claude-code"], dryRun: true });
    const ponytail = await new PonytailAdapter().detect({ platform: "linux", home, selectedAgents: [], dryRun: true });
    expect(caveman.detected).toBe(true);
    expect(ponytail.detected).toBe(true);
  });

  it("install-only does not write Caveman or Ponytail global configs", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "dont-waste-install-only-"));
    const ctx = { platform: "linux" as const, home, selectedAgents: [] as const, dryRun: false };
    const caveman = new CavemanAdapter();
    const ponytail = new PonytailAdapter();
    const cavemanPlan = await caveman.planInstall({ mode: "full", features: {} }, ctx);
    const ponytailPlan = await ponytail.planInstall({ mode: "ultra", features: {} }, ctx);
    expect(cavemanPlan.affectedPaths).toEqual([]);
    expect(ponytailPlan.affectedPaths).toEqual([]);
    expect((await caveman.install({ ...cavemanPlan, commands: [] }, ctx)).succeeded).toBe(true);
    expect((await ponytail.install({ ...ponytailPlan, commands: [] }, ctx)).succeeded).toBe(true);
    await expect(access(path.join(home, ".claude", ".caveman-active"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(path.join(home, ".config", "ponytail", "config.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("uninstall removes only marker-owned files and preserves unrelated config", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "dont-waste-un-"));
    process.env.HOME = home;
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "dont-waste-data-"));
    process.env.DONT_WASTE_DATA_DIR = dataDir;

    await mkdir(path.join(home, ".claude"), { recursive: true });
    await writeFile(path.join(home, ".claude", ".caveman-active"), "ultra\n", "utf8");
    await writeFile(path.join(home, ".claude", "user-notes.txt"), "keep me\n", "utf8");

    await mkdir(path.join(home, ".codex"), { recursive: true });
    await writeFile(path.join(home, ".codex", "config.toml"), "# user prefix\n\nother = true\n", "utf8");
    await registerHeadroomMcp("codex", headroomMcpSpec("/tmp/headroom"), { home, platform: "linux" });

    await mkdir(path.join(home, ".config", "opencode"), { recursive: true });
    await writeFile(path.join(home, ".config", "opencode", "opencode.json"), JSON.stringify({
      plugin: ["keep-me", "@dietrichgebert/ponytail"],
      theme: "dark",
    }, null, 2), "utf8");

    const ponytail = new PonytailAdapter();
    await ponytail.install({
      tool: "ponytail",
      selection: { mode: "full", features: {} },
      commands: [],
      warnings: [],
      affectedPaths: [],
      capabilities: [],
    }, { platform: "linux", home, selectedAgents: ["opencode"], dryRun: false });

    const cavemanResult = await new CavemanAdapter().uninstall({
      platform: "linux", home, selectedAgents: ["claude-code"], dryRun: false,
    });
    expect(cavemanResult.succeeded).toBe(true);
    await expect(access(path.join(home, ".claude", ".caveman-active"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(path.join(home, ".claude", "user-notes.txt"), "utf8")).toBe("keep me\n");

    const mcp = await unregisterHeadroomMcp("codex", { home, platform: "linux" });
    expect(mcp.status).toBe("removed");
    const codex = await readFile(path.join(home, ".codex", "config.toml"), "utf8");
    expect(codex).toContain("# user prefix");
    expect(codex).toContain("other = true");
    expect(codex).not.toContain("mcp_servers.headroom");

    const ponytailResult = await ponytail.uninstall({
      platform: "linux", home, selectedAgents: ["opencode"], dryRun: false,
    });
    expect(ponytailResult.succeeded).toBe(true);
    const opencode = JSON.parse(await readFile(path.join(home, ".config", "opencode", "opencode.json"), "utf8")) as { plugin: string[]; theme: string };
    expect(opencode.plugin).toEqual(["keep-me"]);
    expect(opencode.theme).toBe("dark");
    await expect(access(path.join(home, ".config", "ponytail", "config.json"))).rejects.toMatchObject({ code: "ENOENT" });

    // Ensure temp data dir wiring works for later CLI/doctor tests.
    const paths = getDataPaths();
    expect(paths.root).toBe(dataDir);
  });

  it("configuredToolsFromConfig uses saved modes/features", () => {
    const config = defaultConfig();
    config.integrations = {
      "claude-code": {
        caveman: { enabled: true, mode: "ultra", features: { statusline: true } },
        headroom: { enabled: false, mode: "off", features: {} },
      },
    };
    const tools = configuredToolsFromConfig(config);
    expect(tools).toEqual([
      {
        tool: "caveman",
        selection: { mode: "ultra", features: { statusline: true } },
        agents: ["claude-code"],
      },
    ]);
  });
});
