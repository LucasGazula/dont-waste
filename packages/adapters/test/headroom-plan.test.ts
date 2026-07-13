import { describe, expect, it } from "vitest";
import { HeadroomAdapter } from "../src/headroom.js";

describe("Headroom plan", () => {
  it("registers MCP for every native MCP host without OpenCode wrapping", async () => {
    const adapter = new HeadroomAdapter();
    const plan = await adapter.planInstall(
      { mode: "full", features: {} },
      {
        platform: "linux",
        home: "/tmp",
        selectedAgents: ["opencode", "antigravity-cli", "copilot-cli"],
        dryRun: true,
      },
    );

    expect(plan.commands).not.toContainEqual(
      expect.objectContaining({ args: ["wrap", "opencode"] }),
    );
    expect(plan.warnings).toContain(
      "Headroom MCP (stdio: `headroom mcp serve`) is merged into Codex, Claude, Copilot, Antigravity, and OpenCode configs when absent; existing mismatched entries are never replaced.",
    );
    expect(plan.affectedPaths).toEqual(
      expect.arrayContaining([
        "/tmp/.gemini/config/mcp_config.json",
        "/tmp/.copilot/mcp-config.json",
      ]),
    );
  });
});
