import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  codexConfigPath,
  readMcpServer,
  registerHeadroomMcp,
  headroomMcpSpec,
} from "../src/mcp.js";
import { getAgentPaths } from "../src/agents.js";

const inheritedCodexHome = process.env.CODEX_HOME;

beforeEach(() => {
  delete process.env.CODEX_HOME;
});

afterAll(() => {
  if (inheritedCodexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = inheritedCodexHome;
});

describe("mcp registration", () => {
  it("uses CODEX_HOME for Codex configuration", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "dont-waste-mcp-"));
    const codexHome = path.join(home, "managed-codex");
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;
    try {
      expect(codexConfigPath({ home })).toBe(
        path.join(codexHome, "config.toml"),
      );
      expect(getAgentPaths("codex", { home, platform: "linux" })).toEqual([
        path.join(codexHome, "config.toml"),
        path.join(codexHome, "AGENTS.md"),
      ]);
      const result = await registerHeadroomMcp(
        "codex",
        headroomMcpSpec("/usr/local/bin/headroom"),
        { home, platform: "linux" },
      );
      expect(result.path).toBe(path.join(codexHome, "config.toml"));
      await expect(
        readFile(path.join(home, ".codex", "config.toml"), "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
      await rm(home, { recursive: true, force: true });
    }
  });

  it("writes codex configuration with comments and markers", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "dont-waste-mcp-"));
    const spec = headroomMcpSpec("/usr/local/bin/headroom");
    const result = await registerHeadroomMcp("codex", spec, {
      home,
      platform: "linux",
    });
    expect(result.status).toBe("registered");
    expect(result.path).toContain("config.toml");

    const content = await readFile(result.path!, "utf8");
    expect(content).toContain("# --- Headroom MCP server ---");
    expect(content).toContain("[mcp_servers.headroom]");
    expect(content).toContain('command = "/usr/local/bin/headroom"');
    expect(content).toContain('args = ["mcp", "serve"]');

    const read = await readMcpServer(
      "codex",
      { home, platform: "linux" },
      "headroom",
    );
    expect(read).toEqual(spec);
  });

  it("updates existing codex configuration within markers", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "dont-waste-mcp-"));
    const initial = `# Prefix comment\n\n# --- Headroom MCP server ---\n[mcp_servers.headroom]\ncommand = "/old/headroom"\nargs = ["mcp", "serve"]\n# --- end Headroom MCP server ---\n\n# Suffix comment`;
    await mkdir(path.join(home, ".codex"), { recursive: true });
    await writeFile(path.join(home, ".codex", "config.toml"), initial, "utf8");

    const spec = headroomMcpSpec("/new/headroom");
    const result = await registerHeadroomMcp("codex", spec, {
      home,
      platform: "linux",
    });
    expect(result.status).toBe("registered");

    const content = await readFile(result.path!, "utf8");
    expect(content).toContain("# Prefix comment");
    expect(content).toContain("# Suffix comment");
    expect(content).toContain('command = "/new/headroom"');
    expect(content).not.toContain("/old/headroom");
  });

  it("refuses to overwrite user-defined codex server without markers", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "dont-waste-mcp-"));
    await mkdir(path.join(home, ".codex"), { recursive: true });
    await writeFile(
      path.join(home, ".codex", "config.toml"),
      `[mcp_servers.headroom]\ncommand = "/other/headroom"\nargs = ["mcp", "serve"]\n`,
      "utf8",
    );
    const result = await registerHeadroomMcp(
      "codex",
      headroomMcpSpec("/tmp/headroom"),
      { home, platform: "linux" },
    );
    expect(result.status).toBe("mismatch");
    const content = await readFile(
      path.join(home, ".codex", "config.toml"),
      "utf8",
    );
    expect(content).toContain("/other/headroom");
    expect(content).not.toContain("# --- Headroom MCP server ---");
  });

  it("merges Claude and OpenCode JSON without replacing unrelated keys", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "dont-waste-mcp-"));
    await mkdir(path.join(home, ".claude"), { recursive: true });
    await mkdir(path.join(home, ".config", "opencode"), { recursive: true });
    await writeFile(
      path.join(home, ".claude", "mcp.json"),
      JSON.stringify({ mcpServers: { other: { command: "x" } } }, null, 2),
      "utf8",
    );
    await writeFile(
      path.join(home, ".config", "opencode", "opencode.json"),
      JSON.stringify({ plugin: ["keep"], mcp: {} }, null, 2),
      "utf8",
    );
    const spec = headroomMcpSpec("/opt/headroom");
    const context = { home, platform: "linux" as const };

    expect(
      (await registerHeadroomMcp("claude-code", spec, context)).status,
    ).toBe("registered");
    expect((await registerHeadroomMcp("opencode", spec, context)).status).toBe(
      "registered",
    );

    const claude = JSON.parse(
      await readFile(path.join(home, ".claude", "mcp.json"), "utf8"),
    ) as { mcpServers: Record<string, unknown> };
    expect(claude.mcpServers.other).toEqual({ command: "x" });
    expect(claude.mcpServers.headroom).toEqual({
      command: "/opt/headroom",
      args: ["mcp", "serve"],
    });

    const opencode = JSON.parse(
      await readFile(
        path.join(home, ".config", "opencode", "opencode.json"),
        "utf8",
      ),
    ) as { plugin: string[]; mcp: Record<string, unknown> };
    expect(opencode.plugin).toEqual(["keep"]);
    expect(opencode.mcp.headroom).toMatchObject({
      type: "local",
      command: ["/opt/headroom", "mcp", "serve"],
      enabled: true,
    });

    expect(
      await readMcpServer("claude-code", context, "headroom"),
    ).toMatchObject(spec);
  });
});
