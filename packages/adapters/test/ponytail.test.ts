import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PonytailAdapter, resolvePonytailMode } from "../src/ponytail.js";

describe("ponytail mode persistence", () => {
  it("maps unsupported catalog modes to full", () => {
    expect(resolvePonytailMode("lite")).toBe("lite");
    expect(resolvePonytailMode("ultra")).toBe("ultra");
    expect(resolvePonytailMode("full")).toBe("full");
    expect(resolvePonytailMode("wenyan")).toBe("full");
    expect(resolvePonytailMode("off")).toBe("full");
  });

  it("writes the selected mode into config.json during install", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "dont-waste-ponytail-"));
    const adapter = new PonytailAdapter();
    const context = {
      platform: "linux" as const,
      home,
      selectedAgents: ["opencode" as const],
      dryRun: false,
    };
    const selection = { mode: "ultra" as const, features: {} };
    const plan = await adapter.planInstall(selection, context);
    expect(plan.selection.mode).toBe("ultra");
    expect(plan.warnings[0]).toContain("ultra");

    const result = await adapter.install(plan, context);
    expect(result.succeeded).toBe(true);

    const configPath = path.join(home, ".config", "ponytail", "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8")) as {
      defaultMode: string;
    };
    expect(config.defaultMode).toBe("ultra");

    const checks = await adapter.verify(selection, context);
    expect(checks.find((check) => check.id === "ponytail-mode")).toMatchObject({
      status: "pass",
    });
    await rm(home, { recursive: true, force: true });
  });

  it("passes abortSignal to findExecutable in verify", async () => {
    const adapter = new PonytailAdapter();
    const controller = new AbortController();
    const checks = await adapter.verify(
      { mode: "full", features: {} },
      {
        platform: "linux",
        home: os.tmpdir(),
        selectedAgents: [],
        dryRun: true,
        abortSignal: controller.signal,
      },
    );
    expect(checks.find((c) => c.id === "ponytail-node")).toBeDefined();
  });

  it("preserves a rejected Codex marketplace without aborting other Ponytail steps", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "dont-waste-ponytail-"));
    const adapter = new PonytailAdapter();
    const context = {
      platform: "linux" as const,
      home,
      selectedAgents: ["codex" as const],
      dryRun: false,
    };
    const plan = await adapter.planInstall(
      { mode: "full" as const, features: {} },
      context,
    );

    expect(plan.commands[0]).toMatchObject({
      label: "Add Ponytail marketplace to Codex",
    });

    const started: string[] = [];
    const result = await adapter.install(
      {
        ...plan,
        commands: [
          {
            ...plan.commands[0],
            command: process.execPath,
            args: ["-e", "process.exit(1)"],
          },
          ...plan.commands.slice(1, 2).map((command) => ({
            ...command,
            command: process.execPath,
            args: ["-e", "process.exit(0)"],
            interactive: false,
          })),
          ...plan.commands.slice(2),
        ],
      },
      {
        ...context,
        beforeCommand: (command) => {
          started.push(command.label);
        },
      },
    );

    expect(result.succeeded).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.executed).toHaveLength(2);
    expect(result.skipped.map((command) => command.label)).toEqual([
      "Open Codex /hooks to trust Ponytail hooks, then start a new thread",
    ]);
    expect(started).toEqual([
      "Add Ponytail marketplace to Codex",
      "Install Ponytail plugin in Codex",
      "Open Codex /hooks to trust Ponytail hooks, then start a new thread",
    ]);
    await rm(home, { recursive: true, force: true });
  });

  it("uses Ponytail's official non-interactive Codex plugin command", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "dont-waste-ponytail-"));
    const plan = await new PonytailAdapter().planInstall(
      { mode: "full", features: {} },
      {
        platform: "linux",
        home,
        selectedAgents: ["codex"],
        dryRun: true,
      },
    );

    expect(plan.commands).toEqual([
      expect.objectContaining({
        command: "codex",
        args: ["plugin", "marketplace", "add", "DietrichGebert/ponytail"],
      }),
      expect.objectContaining({
        command: "codex",
        args: ["plugin", "add", "ponytail@ponytail"],
      }),
      expect.objectContaining({
        command: "codex",
        args: [],
        interactive: true,
      }),
    ]);
    await rm(home, { recursive: true, force: true });
  });

  it("does not let global Ponytail state suppress a different host's install", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "dont-waste-ponytail-"));
    await mkdir(path.join(home, ".config", "ponytail"), { recursive: true });
    await writeFile(
      path.join(home, ".config", "ponytail", "config.json"),
      JSON.stringify({ defaultMode: "full" }),
      "utf8",
    );

    const plan = await new PonytailAdapter().planInstall(
      { mode: "full" as const, features: {} },
      {
        platform: "linux" as const,
        home,
        selectedAgents: ["claude-code" as const, "codex" as const],
        dryRun: false,
      },
    );

    expect(plan.commands).toContainEqual(
      expect.objectContaining({
        command: "codex",
        args: ["plugin", "marketplace", "add", "DietrichGebert/ponytail"],
      }),
    );
    expect(plan.commands).toContainEqual(
      expect.objectContaining({
        command: "codex",
        args: ["plugin", "add", "ponytail@ponytail"],
      }),
    );
    expect(plan.commands).toContainEqual(
      expect.objectContaining({
        command: "claude",
        args: ["plugin", "marketplace", "add", "DietrichGebert/ponytail"],
      }),
    );
    await rm(home, { recursive: true, force: true });
  });

  it("skips only the Claude commands when Claude has Ponytail enabled", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "dont-waste-ponytail-"));
    await mkdir(path.join(home, ".claude"), { recursive: true });
    await writeFile(
      path.join(home, ".claude", "settings.json"),
      JSON.stringify({ enabledPlugins: { "ponytail@ponytail": true } }),
      "utf8",
    );

    const plan = await new PonytailAdapter().planInstall(
      { mode: "full" as const, features: {} },
      {
        platform: "linux" as const,
        home,
        selectedAgents: ["claude-code" as const, "codex" as const],
        dryRun: false,
      },
    );

    expect(plan.commands.some((command) => command.command === "claude")).toBe(
      false,
    );
    expect(plan.commands).toContainEqual(
      expect.objectContaining({
        command: "codex",
        args: ["plugin", "add", "ponytail@ponytail"],
      }),
    );
    expect(plan.warnings).toContain(
      "Ponytail is already configured for claude-code; only those hosts skip marketplace-dependent commands.",
    );
    await rm(home, { recursive: true, force: true });
  });

  it("reports a conflict when a stale hidden Ponytail marketplace exists without registration", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "dont-waste-ponytail-"));
    const codexHome = path.join(home, "codex-home");
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;
    process.env.DONT_WASTE_MOCK_CODEX_MARKETPLACE = "false";

    try {
      const staleDir = path.join(codexHome, ".tmp", "marketplaces", "ponytail");
      await mkdir(staleDir, { recursive: true });

      const checks = await new PonytailAdapter().verify(
        { mode: "full", features: {} },
        {
          platform: "linux",
          home,
          selectedAgents: ["codex"],
          dryRun: true,
        },
      );

      const conflictCheck = checks.find(
        (c) => c.id === "ponytail-codex-marketplace-conflict",
      );
      expect(conflictCheck).toBeDefined();
      expect(conflictCheck?.status).toBe("fail");
      expect(conflictCheck?.message).toContain(
        "Stale hidden Ponytail marketplace detected",
      );
      expect(conflictCheck?.remediation).toContain("mv ");
    } finally {
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
      delete process.env.DONT_WASTE_MOCK_CODEX_MARKETPLACE;
      await rm(home, { recursive: true, force: true });
    }
  });

  it("blocks Ponytail installation on live Codex session", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "dont-waste-ponytail-"));
    const previousProcesses = process.env.DONT_WASTE_MOCK_CODEX_PROCESSES;
    process.env.DONT_WASTE_MOCK_CODEX_PROCESSES = JSON.stringify([
      { pid: 99999, cmdline: "codex" },
    ]);

    try {
      const adapter = new PonytailAdapter();
      const plan = await adapter.planInstall(
        { mode: "full", features: {} },
        {
          platform: "linux",
          home,
          selectedAgents: ["codex"],
          dryRun: true,
        },
      );

      const result = await adapter.install(plan, {
        platform: "linux",
        home,
        selectedAgents: ["codex"],
        dryRun: false,
      });

      expect(result.succeeded).toBe(false);
      expect(result.errors[0]).toContain("Active Codex processes detected");
    } finally {
      if (previousProcesses === undefined)
        delete process.env.DONT_WASTE_MOCK_CODEX_PROCESSES;
      else process.env.DONT_WASTE_MOCK_CODEX_PROCESSES = previousProcesses;
      await rm(home, { recursive: true, force: true });
    }
  });

  it("blocks Ponytail installation on stale marketplace conflict", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "dont-waste-ponytail-"));
    const codexHome = path.join(home, "codex-home");
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;
    process.env.DONT_WASTE_MOCK_CODEX_MARKETPLACE = "false";

    try {
      const staleDir = path.join(codexHome, ".tmp", "marketplaces", "ponytail");
      await mkdir(staleDir, { recursive: true });

      const adapter = new PonytailAdapter();
      const plan = await adapter.planInstall(
        { mode: "full", features: {} },
        {
          platform: "linux",
          home,
          selectedAgents: ["codex"],
          dryRun: true,
        },
      );

      const result = await adapter.install(plan, {
        platform: "linux",
        home,
        selectedAgents: ["codex"],
        dryRun: false,
      });

      expect(result.succeeded).toBe(false);
      expect(result.errors[0]).toContain(
        "Stale hidden Ponytail marketplace detected",
      );
    } finally {
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
      delete process.env.DONT_WASTE_MOCK_CODEX_MARKETPLACE;
      await rm(home, { recursive: true, force: true });
    }
  });
});
