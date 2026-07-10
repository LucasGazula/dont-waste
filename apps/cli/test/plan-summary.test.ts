import { describe, expect, it } from "vitest";
import { formatPlanSummary, summarizePlanByAgent } from "../src/plan-summary.js";
import type { OperationPlan } from "@dont-waste/adapters";

describe("init plan summary", () => {
  it("builds per-agent impact with files, restart, compatibility, and reversal", () => {
    const plans: OperationPlan[] = [{
      tool: "headroom",
      selection: { mode: "full", features: {} },
      commands: [{ command: "headroom", args: ["wrap", "codex"], label: "wrap", interactive: true }],
      affectedPaths: ["/home/u/.codex/config.toml", "/home/u/.claude/mcp.json"],
      warnings: ["Headroom wrap is a launch path only for codex"],
      capabilities: [{
        agent: "codex",
        capability: { tool: "headroom", agent: "codex", installMethod: "proxy", prerequisites: [], supportsMetrics: "measured" },
      }],
    }, {
      tool: "rtk",
      selection: { mode: "full", features: {} },
      commands: [{ command: "rtk", args: ["init", "-g", "--codex"], label: "init" }],
      affectedPaths: [],
      warnings: [],
      capabilities: [{
        agent: "codex",
        capability: { tool: "rtk", agent: "codex", installMethod: "hook", prerequisites: [], supportsMetrics: "measured" },
      }],
    }];

    const rows = summarizePlanByAgent({ profile: "balanced", selectedAgents: ["codex", "claude-code"], plans });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.restartRequired).toBe(true);
    expect(rows[0]?.files).toContain("/home/u/.codex/config.toml");
    expect(rows[0]?.compatibility.some((line) => line.includes("proxy"))).toBe(true);
    expect(rows[0]?.reversal.length).toBeGreaterThan(0);

    const text = formatPlanSummary({ profile: "balanced", selectedAgents: ["codex"], plans });
    expect(text).toContain("Per-agent impact:");
    expect(text).toContain("[interactive/launch-only]");
    expect(text).toContain("compatibility:");
    expect(text).toContain("reversal:");
    expect(text).toContain("Advanced controls");
  });

  it("notes install-only profile without agent activation", () => {
    const text = formatPlanSummary({ profile: "install-only", selectedAgents: [], plans: [] });
    expect(text).toContain("install-only");
    expect(text).toContain("no agent integrations will be activated");
  });
});
