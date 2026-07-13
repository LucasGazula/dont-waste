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

  it("stops before plugin install when Codex marketplace registration is rejected", async () => {
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

    expect(result.succeeded).toBe(false);
    expect(result.errors).toEqual([
      "Add Ponytail marketplace to Codex exited with 1",
    ]);
    expect(result.executed).toHaveLength(1);
    expect(result.skipped.map((command) => command.label)).toEqual([
      "Install Ponytail plugin in Codex",
      "Open Codex /hooks to trust Ponytail hooks, then start a new thread",
    ]);
    expect(started).toEqual(["Add Ponytail marketplace to Codex"]);
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

  it("does not rerun marketplace-dependent Codex commands for an existing Ponytail install", async () => {
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
        selectedAgents: ["codex" as const],
        dryRun: false,
      },
    );

    expect(plan.commands.some((command) => isMarketplaceCommand(command))).toBe(
      false,
    );
    expect(plan.commands).not.toContainEqual(
      expect.objectContaining({
        command: "codex",
        args: ["plugin", "add", "ponytail@ponytail"],
      }),
    );
    expect(plan.warnings).toContain(
      "Existing Ponytail install detected; marketplace registration and dependent plugin installation are skipped while existing sources are preserved.",
    );
    await rm(home, { recursive: true, force: true });
  });
});

function isMarketplaceCommand(command: { args: string[] }): boolean {
  return (
    command.args[0] === "plugin" &&
    command.args[1] === "marketplace" &&
    command.args[2] === "add"
  );
}
