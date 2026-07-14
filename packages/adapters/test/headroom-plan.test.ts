import { describe, expect, it } from "vitest";
import { HeadroomAdapter } from "../src/headroom.js";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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

  it("blocks activation when fresh-session acceptance file is absent", async () => {
    const home = await mkdtemp(
      path.join(os.tmpdir(), "dont-waste-headroom-activation-"),
    );
    const adapter = new HeadroomAdapter();
    await mkdir(path.join(home, ".codex"), { recursive: true });
    // Write an expected MCP config so verification runs the acceptance check
    await writeFile(
      path.join(home, ".codex", "config.toml"),
      `[mcp_servers.headroom]\ncommand = "headroom"\nargs = ["mcp", "serve"]\n`,
      "utf8",
    );

    const checks = await adapter.verify(
      { mode: "full", features: {} },
      {
        platform: "linux",
        home,
        selectedAgents: ["codex"],
        dryRun: true,
      },
    );

    const acceptanceCheck = checks.find(
      (c) => c.id === "headroom-mcp-codex-acceptance",
    );
    expect(acceptanceCheck).toBeDefined();
    expect(acceptanceCheck?.status).toBe("fail");
    expect(acceptanceCheck?.blocksActivation).toBe(true);

    await rm(home, { recursive: true, force: true });
  });

  it("passes activation when fresh-session acceptance file is present", async () => {
    const home = await mkdtemp(
      path.join(os.tmpdir(), "dont-waste-headroom-activation-"),
    );
    const adapter = new HeadroomAdapter();
    await mkdir(path.join(home, ".codex"), { recursive: true });
    await writeFile(
      path.join(home, ".codex", "config.toml"),
      `[mcp_servers.headroom]\ncommand = "headroom"\nargs = ["mcp", "serve"]\n`,
      "utf8",
    );

    // Create the acceptance file
    await writeFile(
      path.join(home, ".headroom-mcp-codex-accepted"),
      "accepted",
      "utf8",
    );

    const checks = await adapter.verify(
      { mode: "full", features: {} },
      {
        platform: "linux",
        home,
        selectedAgents: ["codex"],
        dryRun: true,
      },
    );

    const acceptanceCheck = checks.find(
      (c) => c.id === "headroom-mcp-codex-acceptance",
    );
    expect(acceptanceCheck).toBeDefined();
    expect(acceptanceCheck?.status).toBe("pass");

    await rm(home, { recursive: true, force: true });
  });
});
