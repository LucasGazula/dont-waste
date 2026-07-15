import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  antigravityMcpConfigPath,
  claudeMcpConfigPath,
  codexConfigPath,
  copilotMcpConfigPath,
  readMcpServer,
  registerHeadroomMcp,
  unregisterHeadroomMcp,
  headroomMcpSpec,
} from "../src/mcp.js";
import { getAgentPaths } from "../src/agents.js";

const inheritedCodexHome = process.env.CODEX_HOME;
const inheritedCopilotHome = process.env.COPILOT_HOME;

beforeEach(() => {
  delete process.env.CODEX_HOME;
  delete process.env.COPILOT_HOME;
});

afterAll(() => {
  if (inheritedCodexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = inheritedCodexHome;
  if (inheritedCopilotHome === undefined) delete process.env.COPILOT_HOME;
  else process.env.COPILOT_HOME = inheritedCopilotHome;
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

  it("uses COPILOT_HOME for Copilot MCP configuration", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "dont-waste-mcp-"));
    const copilotHome = path.join(home, "managed-copilot");
    const previousCopilotHome = process.env.COPILOT_HOME;
    process.env.COPILOT_HOME = copilotHome;
    try {
      const spec = headroomMcpSpec("/usr/local/bin/headroom");
      const result = await registerHeadroomMcp("copilot-cli", spec, {
        home,
        platform: "linux",
      });
      expect(result.path).toBe(path.join(copilotHome, "mcp-config.json"));
      expect(
        await readMcpServer(
          "copilot-cli",
          { home, platform: "linux" },
          "headroom",
        ),
      ).toMatchObject(spec);
    } finally {
      if (previousCopilotHome === undefined) delete process.env.COPILOT_HOME;
      else process.env.COPILOT_HOME = previousCopilotHome;
      await rm(home, { recursive: true, force: true });
    }
  });

  it("uses Claude Code's current user MCP registry", () => {
    expect(claudeMcpConfigPath({ home: "/tmp/home" })).toBe(
      "/tmp/home/.claude.json",
    );
  });

  it("mirrors Codex MCP into system ~/.codex when CODEX_HOME is Orca-managed", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "dont-waste-mcp-"));
    const managed = path.join(home, "codex-runtime-home", "home");
    await mkdir(managed, { recursive: true });
    const previous = process.env.CODEX_HOME;
    process.env.CODEX_HOME = managed;
    try {
      const result = await registerHeadroomMcp(
        "codex",
        headroomMcpSpec("/opt/headroom"),
        { home, platform: "linux" },
      );
      expect(result.status).toBe("registered");
      await expect(
        readFile(path.join(managed, "config.toml"), "utf8"),
      ).resolves.toContain("[mcp_servers.headroom]");
      await expect(
        readFile(path.join(home, ".codex", "config.toml"), "utf8"),
      ).resolves.toContain("[mcp_servers.headroom]");
    } finally {
      if (previous === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previous;
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

  it("repairs an otherwise-empty interrupted Codex marker", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "dont-waste-mcp-"));
    const file = path.join(home, ".codex", "config.toml");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
      file,
      'model = "gpt-5"\n\n# --- Headroom MCP server ---\n',
      "utf8",
    );

    const result = await registerHeadroomMcp(
      "codex",
      headroomMcpSpec("/opt/headroom"),
      { home, platform: "linux" },
    );

    expect(result).toMatchObject({ status: "registered" });
    const content = await readFile(file, "utf8");
    expect(content).toContain("[mcp_servers.headroom]");
    expect(content).toContain("# --- end Headroom MCP server ---");
    expect(content.match(/# --- Headroom MCP server ---/g)).toHaveLength(1);
    await rm(home, { recursive: true, force: true });
  });

  it("repairs an orphan Headroom start marker followed by unrelated sections", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "dont-waste-mcp-"));
    const file = path.join(home, ".codex", "config.toml");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
      file,
      [
        'model = "gpt-5.6-terra"',
        "",
        "# --- Headroom MCP server ---",
        "",
        '[hooks.state."/tmp/hooks.json:session_start:0:0"]',
        "enabled = true",
        'trusted_hash = "sha256:abc"',
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await registerHeadroomMcp(
      "codex",
      headroomMcpSpec("/opt/headroom"),
      { home, platform: "linux" },
    );

    expect(result).toMatchObject({ status: "registered" });
    const content = await readFile(file, "utf8");
    expect(content).toContain("[mcp_servers.headroom]");
    expect(content).toContain("# --- end Headroom MCP server ---");
    expect(content).toContain("[hooks.state.");
    expect(content.match(/# --- Headroom MCP server ---/g)).toHaveLength(1);
    await rm(home, { recursive: true, force: true });
  });

  it("accepts a matching Codex server when another CLI left an orphan marker", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "dont-waste-mcp-"));
    const file = path.join(home, ".codex", "config.toml");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
      file,
      `[mcp_servers.headroom]\ncommand = "/opt/headroom"\nargs = ["mcp", "serve"]\n# --- end Headroom MCP server ---\n`,
      "utf8",
    );

    const result = await registerHeadroomMcp(
      "codex",
      headroomMcpSpec("/opt/headroom"),
      { home, platform: "linux" },
    );

    expect(result).toMatchObject({ status: "already" });
    await rm(home, { recursive: true, force: true });
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

  it("merges JSON MCP configurations without replacing unrelated keys", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "dont-waste-mcp-"));
    await mkdir(path.join(home, ".copilot"), { recursive: true });
    await mkdir(path.join(home, ".gemini", "config"), { recursive: true });
    await mkdir(path.join(home, ".config", "opencode"), { recursive: true });
    await writeFile(
      claudeMcpConfigPath({ home }),
      JSON.stringify({ mcpServers: { other: { command: "x" } } }, null, 2),
      "utf8",
    );
    await writeFile(
      path.join(home, ".config", "opencode", "opencode.json"),
      JSON.stringify({ plugin: ["keep"], mcp: {} }, null, 2),
      "utf8",
    );
    await writeFile(
      copilotMcpConfigPath({ home }),
      JSON.stringify({ mcpServers: { keep: { command: "copilot-keep" } } }),
      "utf8",
    );
    await writeFile(
      antigravityMcpConfigPath({ home }),
      JSON.stringify({ mcpServers: { keep: { command: "agy-keep" } } }),
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
    expect(
      (await registerHeadroomMcp("copilot-cli", spec, context)).status,
    ).toBe("registered");
    expect(
      (await registerHeadroomMcp("antigravity-cli", spec, context)).status,
    ).toBe("registered");

    const claude = JSON.parse(
      await readFile(claudeMcpConfigPath({ home }), "utf8"),
    ) as { mcpServers: Record<string, unknown> };
    expect(claude.mcpServers.other).toEqual({ command: "x" });
    expect(claude.mcpServers.headroom).toEqual({
      type: "stdio",
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

    for (const [agent, file, expectedKeep] of [
      ["copilot-cli", copilotMcpConfigPath({ home }), "copilot-keep"],
      ["antigravity-cli", antigravityMcpConfigPath({ home }), "agy-keep"],
    ] as const) {
      const parsed = JSON.parse(await readFile(file, "utf8")) as {
        mcpServers: Record<string, { command: string; args?: string[] }>;
      };
      expect(parsed.mcpServers.keep).toEqual({ command: expectedKeep });
      expect(parsed.mcpServers.headroom).toEqual({
        command: "/opt/headroom",
        args: ["mcp", "serve"],
      });
      expect(await readMcpServer(agent, context, "headroom")).toMatchObject(
        spec,
      );
    }

    expect(
      await readMcpServer("claude-code", context, "headroom"),
    ).toMatchObject(spec);
  });

  it("does not replace a conflicting Antigravity MCP server", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "dont-waste-mcp-"));
    const file = antigravityMcpConfigPath({ home });
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
      file,
      JSON.stringify({
        mcpServers: {
          headroom: { command: "/other/headroom", args: ["mcp", "serve"] },
        },
      }),
      "utf8",
    );

    const result = await registerHeadroomMcp(
      "antigravity-cli",
      headroomMcpSpec("/expected/headroom"),
      { home, platform: "linux" },
    );

    expect(result.status).toBe("mismatch");
    expect(await readFile(file, "utf8")).toContain("/other/headroom");
  });

  it("initializes an empty Antigravity MCP configuration", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "dont-waste-mcp-"));
    const file = antigravityMcpConfigPath({ home });
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "", "utf8");

    const result = await registerHeadroomMcp(
      "antigravity-cli",
      headroomMcpSpec("/opt/headroom"),
      { home, platform: "linux" },
    );

    expect(result.status).toBe("registered");
    expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({
      mcpServers: {
        headroom: { command: "/opt/headroom", args: ["mcp", "serve"] },
      },
    });
  });

  it("only removes JSON MCP entries recorded as Don’t Waste-owned", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "dont-waste-mcp-"));
    const context = { home, platform: "linux" as const };
    const spec = headroomMcpSpec("/opt/headroom");
    await registerHeadroomMcp("antigravity-cli", spec, context);
    expect(
      (await unregisterHeadroomMcp("antigravity-cli", context)).status,
    ).toBe("removed");

    const file = antigravityMcpConfigPath({ home });
    await writeFile(
      file,
      JSON.stringify({
        mcpServers: { headroom: { command: "/user/headroom" } },
      }),
      "utf8",
    );
    expect(
      (await unregisterHeadroomMcp("antigravity-cli", context)).status,
    ).toBe("preserved");
  });

  it("blocks registration and unregistration when active Codex processes are detected", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "dont-waste-mcp-"));
    const context = { home, platform: "linux" as const };
    const spec = headroomMcpSpec("/opt/headroom");

    process.env.DONT_WASTE_MOCK_CODEX_PROCESSES = JSON.stringify([
      { pid: 12345, cmdline: "node codex" },
    ]);

    try {
      const regResult = await registerHeadroomMcp("codex", spec, context);
      expect(regResult.status).toBe("failed");
      expect(regResult.detail).toContain("12345");

      const unregResult = await unregisterHeadroomMcp("codex", context);
      expect(unregResult.status).toBe("failed");
      expect(unregResult.detail).toContain("12345");
    } finally {
      delete process.env.DONT_WASTE_MOCK_CODEX_PROCESSES;
      await rm(home, { recursive: true, force: true });
    }
  });
});
