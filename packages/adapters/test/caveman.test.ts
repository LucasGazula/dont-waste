import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CavemanAdapter,
  cavemanOnlyId,
  resolveCavemanMode,
} from "../src/caveman.js";

describe("caveman adapter planning", () => {
  it("maps agents to official --only ids and persists selected mode", async () => {
    expect(cavemanOnlyId["claude-code"]).toBe("claude");
    expect(cavemanOnlyId.opencode).toBe("opencode");
    expect(resolveCavemanMode("ultra")).toBe("ultra");
    expect(resolveCavemanMode("wenyan")).toBe("wenyan");

    const home = await mkdtemp(path.join(os.tmpdir(), "dont-waste-caveman-"));
    const adapter = new CavemanAdapter();
    const context = {
      platform: "linux" as const,
      home,
      selectedAgents: [
        "claude-code" as const,
        "opencode" as const,
        "pi" as const,
      ],
      dryRun: true,
    };
    const selection = {
      mode: "ultra" as const,
      features: { statusline: false },
    };
    const plan = await adapter.planInstall(selection, context);
    expect(plan.commands[0]?.command).toBe("npx");
    expect(plan.commands[0]?.args).toEqual(
      expect.arrayContaining([
        "--only",
        "claude",
        "--only",
        "opencode",
        "--non-interactive",
      ]),
    );
    expect(plan.commands[0]?.args).not.toContain("pi");
    expect(plan.warnings.some((item) => item.includes("pi"))).toBe(true);

    const live = {
      ...context,
      dryRun: false,
      selectedAgents: ["claude-code" as const, "opencode" as const],
    };
    const result = await adapter.install(
      { ...plan, selection, commands: [] },
      live,
    );
    expect(result.succeeded).toBe(true);
    expect(
      await readFile(path.join(home, ".claude", ".caveman-active"), "utf8"),
    ).toBe("ultra\n");
    expect(
      await readFile(
        path.join(home, ".config", "opencode", ".caveman-active"),
        "utf8",
      ),
    ).toBe("ultra\n");

    const checks = await adapter.verify(selection, live);
    expect(
      checks.filter((check) => check.status === "pass").length,
    ).toBeGreaterThanOrEqual(2);
  });
});
