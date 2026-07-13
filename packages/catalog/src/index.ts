import { z } from "zod";

export const toolIds = ["headroom", "rtk", "caveman", "ponytail"] as const;
export const agentIds = [
  "codex",
  "claude-code",
  "copilot-cli",
  "antigravity-cli",
  "opencode",
  "pi",
] as const;
export const modes = ["off", "lite", "full", "ultra", "wenyan"] as const;

export type ToolId = (typeof toolIds)[number];
export type AgentId = (typeof agentIds)[number];
export type Mode = (typeof modes)[number];
export type InstallMethod =
  "plugin" | "hook" | "proxy" | "mcp" | "extension" | "rules";
export type MetricSupport = "measured" | "estimated" | "unavailable";

export const capabilitySchema = z.object({
  tool: z.enum(toolIds),
  agent: z.enum(agentIds),
  installMethod: z.enum([
    "plugin",
    "hook",
    "proxy",
    "mcp",
    "extension",
    "rules",
  ]),
  prerequisites: z.array(z.string()),
  supportsMetrics: z.enum(["measured", "estimated", "unavailable"]),
  conflictsWith: z.array(z.string()).default([]),
});
export type Capability = {
  tool: ToolId;
  agent: AgentId;
  installMethod: InstallMethod;
  prerequisites: string[];
  supportsMetrics: MetricSupport;
  conflictsWith?: string[];
};

export type AgentDefinition = {
  id: AgentId;
  label: string;
  executable: string;
  configPaths: { linux: string[]; darwin: string[]; win32: string[] };
};

const home = "~";
export const agents: readonly AgentDefinition[] = [
  {
    id: "codex",
    label: "Codex",
    executable: "codex",
    configPaths: {
      linux: [`${home}/.codex/config.toml`, `${home}/.codex/AGENTS.md`],
      darwin: [`${home}/.codex/config.toml`, `${home}/.codex/AGENTS.md`],
      win32: [`${home}/.codex/config.toml`, `${home}/.codex/AGENTS.md`],
    },
  },
  {
    id: "claude-code",
    label: "Claude Code",
    executable: "claude",
    configPaths: {
      linux: [`${home}/.claude/settings.json`],
      darwin: [`${home}/.claude/settings.json`],
      win32: [`${home}/.claude/settings.json`],
    },
  },

  {
    id: "copilot-cli",
    label: "GitHub Copilot CLI",
    executable: "copilot",
    configPaths: {
      linux: [
        `${home}/.copilot/settings.json`,
        `${home}/.copilot/mcp-config.json`,
      ],
      darwin: [
        `${home}/.copilot/settings.json`,
        `${home}/.copilot/mcp-config.json`,
      ],
      win32: [
        `${home}/.copilot/settings.json`,
        `${home}/.copilot/mcp-config.json`,
      ],
    },
  },
  {
    id: "antigravity-cli",
    label: "Antigravity CLI",
    executable: "agy",
    configPaths: {
      linux: [
        `${home}/.gemini/antigravity-cli/settings.json`,
        `${home}/.gemini/config/mcp_config.json`,
      ],
      darwin: [
        `${home}/.gemini/antigravity-cli/settings.json`,
        `${home}/.gemini/config/mcp_config.json`,
      ],
      win32: [
        `${home}/.gemini/antigravity-cli/settings.json`,
        `${home}/.gemini/config/mcp_config.json`,
      ],
    },
  },
  {
    id: "opencode",
    label: "OpenCode",
    executable: "opencode",
    configPaths: {
      linux: [`${home}/.config/opencode/opencode.json`],
      darwin: [`${home}/.config/opencode/opencode.json`],
      win32: [`${home}/.config/opencode/opencode.json`],
    },
  },
  {
    id: "pi",
    label: "Pi",
    executable: "pi",
    configPaths: {
      linux: [`${home}/.pi/settings.json`],
      darwin: [`${home}/.pi/settings.json`],
      win32: [`${home}/.pi/settings.json`],
    },
  },
] as const;

export const upstream = {
  headroom: {
    repository: "https://github.com/headroomlabs-ai/headroom",
    install: 'uv tool install "headroom-ai[all]"',
    requires: ["Python 3.10+", "uv or pip"],
  },
  rtk: {
    repository: "https://github.com/rtk-ai/rtk",
    install: "official release binary or installer",
    requires: [],
  },
  caveman: {
    repository: "https://github.com/JuliusBrussee/caveman",
    install: "official installer or agent plugin",
    requires: ["Node.js 18+"],
  },
  ponytail: {
    repository: "https://github.com/DietrichGebert/ponytail",
    install: "official agent plugin or extension",
    requires: ["Node.js on non-interactive PATH for hooks"],
  },
} as const;

const headroomMcpAgents: AgentId[] = [
  "codex",
  "claude-code",
  "copilot-cli",
  "antigravity-cli",
  "opencode",
];
export const capabilities: readonly Capability[] = agentIds.flatMap((agent) => {
  const result: Capability[] = [
    {
      tool: "rtk",
      agent,
      installMethod: "hook",
      prerequisites: ["rtk on PATH"],
      supportsMetrics: "measured",
    },
    {
      tool: "caveman",
      agent,
      installMethod: agent === "antigravity-cli" ? "extension" : "plugin",
      prerequisites: ["Node.js 18+"],
      supportsMetrics: "estimated",
    },
    {
      tool: "ponytail",
      agent,
      installMethod: agent === "antigravity-cli" ? "extension" : "plugin",
      prerequisites: ["agent CLI"],
      supportsMetrics: "unavailable",
    },
  ];
  if (headroomMcpAgents.includes(agent)) {
    result.push({
      tool: "headroom",
      agent,
      installMethod: "mcp",
      prerequisites: ["Python 3.10+", "headroom CLI"],
      supportsMetrics: "measured",
    });
  } else {
    result.push({
      tool: "headroom",
      agent,
      installMethod: "extension",
      prerequisites: ["Pi MCP bridge extension"],
      supportsMetrics: "measured",
    });
  }
  return result;
});

export function getCapability(tool: ToolId, agent: AgentId): Capability {
  const capability = capabilities.find(
    (item) => item.tool === tool && item.agent === agent,
  );
  if (!capability) throw new Error(`No capability for ${tool}/${agent}`);
  return capability;
}

export function balancedSelection(): Record<ToolId, Mode> {
  return { headroom: "full", rtk: "full", caveman: "full", ponytail: "full" };
}
