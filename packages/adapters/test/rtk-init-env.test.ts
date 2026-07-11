import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RtkAdapter } from "../src/rtk.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("RTK init commands avoid telemetry hang", () => {
  it("sets RTK_TELEMETRY_DISABLED=1 and a timeout on every agent init", async () => {
    const adapter = new RtkAdapter();
    const home = await mkdtemp(path.join(os.tmpdir(), "dw-rtk-home-"));
    tempDirs.push(home);
    const plan = await adapter.planInstall(
      { mode: "full", features: {} },
      {
        platform: process.platform,
        home,
        dryRun: true,
        selectedAgents: [
          "codex",
          "claude-code",
          "gemini-cli",
          "copilot-cli",
          "antigravity-cli",
          "opencode",
          "pi",
        ],
      },
    );
    const inits = plan.commands.filter((command) =>
      command.args.includes("init"),
    );
    expect(inits).toHaveLength(7);
    for (const command of inits) {
      expect(command.env?.RTK_TELEMETRY_DISABLED).toBe("1");
      expect(command.timeoutMs).toBeGreaterThan(0);
      expect(command.forceKillAfterDelay).toBeGreaterThan(0);
    }
  });
});
