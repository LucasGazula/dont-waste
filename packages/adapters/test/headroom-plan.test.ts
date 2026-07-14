import { describe, expect, it } from "vitest";
import { HeadroomAdapter } from "../src/headroom.js";
import { mkdtemp, writeFile, mkdir, rm, chmod } from "node:fs/promises";
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
    const mockBinDir = path.join(home, "bin");
    await mkdir(mockBinDir, { recursive: true });
    const isWin = process.platform === "win32";
    const mockHeadroom = path.join(
      mockBinDir,
      isWin ? "headroom.cmd" : "headroom",
    );
    await writeFile(
      mockHeadroom,
      isWin ? "@echo headroom 0.1.0\n" : "#!/bin/sh\necho headroom 0.1.0\n",
      "utf8",
    );
    if (!isWin) {
      await chmod(mockHeadroom, 0o755);
    }
    const previousPath = process.env.PATH;
    const pathSeparator = isWin ? ";" : ":";
    process.env.PATH = `${mockBinDir}${pathSeparator}${previousPath}`;

    try {
      const adapter = new HeadroomAdapter();
      await mkdir(path.join(home, ".codex"), { recursive: true });
      // Write an expected MCP config so verification runs the acceptance check
      await writeFile(
        path.join(home, ".codex", "config.toml"),
        `[mcp_servers.headroom]\ncommand = "${mockHeadroom.replace(/\\/g, "\\\\")}"\nargs = ["mcp", "serve"]\n`,
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
    } finally {
      process.env.PATH = previousPath;
      await rm(home, { recursive: true, force: true });
    }
  });

  it("passes activation when fresh-session acceptance file is present", async () => {
    const home = await mkdtemp(
      path.join(os.tmpdir(), "dont-waste-headroom-activation-"),
    );
    const mockBinDir = path.join(home, "bin");
    await mkdir(mockBinDir, { recursive: true });
    const isWin = process.platform === "win32";
    const mockHeadroom = path.join(
      mockBinDir,
      isWin ? "headroom.cmd" : "headroom",
    );
    await writeFile(
      mockHeadroom,
      isWin ? "@echo headroom 0.1.0\n" : "#!/bin/sh\necho headroom 0.1.0\n",
      "utf8",
    );
    if (!isWin) {
      await chmod(mockHeadroom, 0o755);
    }
    const previousPath = process.env.PATH;
    const pathSeparator = isWin ? ";" : ":";
    process.env.PATH = `${mockBinDir}${pathSeparator}${previousPath}`;

    try {
      const adapter = new HeadroomAdapter();
      await mkdir(path.join(home, ".codex"), { recursive: true });
      await writeFile(
        path.join(home, ".codex", "config.toml"),
        `[mcp_servers.headroom]\ncommand = "${mockHeadroom.replace(/\\/g, "\\\\")}"\nargs = ["mcp", "serve"]\n`,
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
    } finally {
      process.env.PATH = previousPath;
      await rm(home, { recursive: true, force: true });
    }
  });
});
