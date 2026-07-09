import { mkdtemp, readFile } from "node:fs/promises";
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
    const context = { platform: "linux" as const, home, selectedAgents: ["opencode" as const], dryRun: false };
    const selection = { mode: "ultra" as const, features: {} };
    const plan = await adapter.planInstall(selection, context);
    expect(plan.selection.mode).toBe("ultra");
    expect(plan.warnings[0]).toContain("ultra");

    const result = await adapter.install(plan, context);
    expect(result.succeeded).toBe(true);

    const configPath = path.join(home, ".config", "ponytail", "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8")) as { defaultMode: string };
    expect(config.defaultMode).toBe("ultra");

    const checks = await adapter.verify(selection, context);
    expect(checks.find((check) => check.id === "ponytail-mode")).toMatchObject({ status: "pass" });
  });
});
