import { describe, expect, it } from "vitest";
import { HeadroomAdapter } from "../src/headroom.js";

describe("Headroom plan", () => {
  it("does not plan an unsupported OpenCode wrap command", async () => {
    const adapter = new HeadroomAdapter();
    const plan = await adapter.planInstall(
      { mode: "full", features: {} },
      {
        platform: "linux",
        home: "/tmp",
        selectedAgents: ["opencode"],
        dryRun: true,
      },
    );

    expect(plan.commands).not.toContainEqual(
      expect.objectContaining({ args: ["wrap", "opencode"] }),
    );
    expect(plan.warnings).toContain(
      "Headroom MCP (stdio: `headroom mcp serve`) is merged into Codex/Claude/OpenCode configs when absent; existing mismatched entries are never replaced.",
    );
  });
});
