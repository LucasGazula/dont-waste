import { describe, expect, it } from "vitest";
import { formatPlanSummary } from "../src/plan-summary.js";
import { compareUpdates, toolsNeedingUpdate } from "../src/updates.js";

/** Non-destructive CLI helper contracts used by CI smoke (no real installers). */
describe("cli smoke helpers", () => {
  it("formats an init plan with per-agent impact", () => {
    const text = formatPlanSummary({
      profile: "balanced",
      selectedAgents: ["codex"],
      plans: [
        {
          tool: "rtk",
          selection: { mode: "full", features: {} },
          commands: [
            { command: "rtk", args: ["init", "-g", "--codex"], label: "init" },
          ],
          affectedPaths: ["/home/u/.codex/config.toml"],
          warnings: [],
          capabilities: [],
        },
      ],
    });
    expect(text).toContain("Per-agent impact:");
    expect(text).toContain("codex");
    expect(text).toContain("/home/u/.codex/config.toml");
  });

  it("only schedules tools that need updates", () => {
    const needing = toolsNeedingUpdate(
      compareUpdates(
        [
          { tool: "rtk", installed: "0.1.0", detected: true },
          { tool: "headroom", installed: "1.0.0", detected: true },
        ],
        [
          { tool: "rtk", latest: "0.2.0", url: "x" },
          { tool: "headroom", latest: "1.0.0", url: "y" },
        ],
      ),
    );
    expect(needing).toEqual(["rtk"]);
  });
});
