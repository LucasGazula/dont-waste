import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentId } from "@dont-waste/catalog";
import { headroomFeatureEnv } from "./advanced-controls.js";
import type { AdapterContext } from "./types.js";

export type McpServerSpec = {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string> | undefined;
};

export type McpRegisterStatus =
  "registered" | "already" | "mismatch" | "unsupported" | "failed";

export type McpRegisterResult = {
  agent: AgentId;
  status: McpRegisterStatus;
  path?: string | undefined;
  detail: string;
};

const MARKER_START = "# --- Headroom MCP server ---";
const MARKER_END = "# --- end Headroom MCP server ---";

function specsMatch(
  existing: McpServerSpec,
  requested: McpServerSpec,
): boolean {
  return (
    existing.command === requested.command &&
    existing.args.length === requested.args.length &&
    existing.args.every((arg, index) => arg === requested.args[index]) &&
    JSON.stringify(existing.env ?? {}) === JSON.stringify(requested.env ?? {})
  );
}

function tomlString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function renderCodexBlock(spec: McpServerSpec): string {
  const lines = [
    MARKER_START,
    `[mcp_servers.${spec.name}]`,
    `command = ${tomlString(spec.command)}`,
  ];
  if (spec.args.length)
    lines.push(`args = [${spec.args.map(tomlString).join(", ")}]`);
  if (spec.env && Object.keys(spec.env).length) {
    lines.push("");
    lines.push(`[mcp_servers.${spec.name}.env]`);
    for (const [key, value] of Object.entries(spec.env))
      lines.push(`${key} = ${tomlString(value)}`);
  }
  lines.push(MARKER_END);
  return lines.join("\n");
}

function parseCodexServer(
  content: string,
  name: string,
): McpServerSpec | undefined {
  const section = content.match(
    new RegExp(`\\[mcp_servers\\.${name}\\]([\\s\\S]*?)(?=\\n\\[|$)`),
  );
  if (!section) return undefined;
  const body = section[1] ?? "";
  const command = body
    .match(/^\s*command\s*=\s*"((?:\\.|[^"])*)"/m)?.[1]
    ?.replaceAll('\\"', '"')
    .replaceAll("\\\\", "\\");
  if (!command) return undefined;
  const argsMatch = body.match(/^\s*args\s*=\s*\[([^\]]*)\]/m);
  const args = argsMatch?.[1]
    ? [...argsMatch[1].matchAll(/"((?:\\.|[^"])*)"/g)].map((item) =>
        item[1]!.replaceAll('\\"', '"').replaceAll("\\\\", "\\"),
      )
    : [];
  const envSection = content.match(
    new RegExp(`\\[mcp_servers\\.${name}\\.env\\]([\\s\\S]*?)(?=\\n\\[|$)`),
  );
  let env: Record<string, string> | undefined;
  if (envSection?.[1]) {
    env = {};
    for (const match of envSection[1].matchAll(
      /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"((?:\\.|[^"])*)"/gm,
    )) {
      env[match[1]!] = match[2]!
        .replaceAll('\\"', '"')
        .replaceAll("\\\\", "\\");
    }
    if (!Object.keys(env).length) env = undefined;
  }
  return { name, command, args, env };
}

export function codexConfigPath(context: Pick<AdapterContext, "home">): string {
  return path.join(
    process.env.CODEX_HOME ?? path.join(context.home, ".codex"),
    "config.toml",
  );
}

export function claudeMcpConfigPath(
  context: Pick<AdapterContext, "home">,
): string {
  return path.join(context.home, ".claude", "mcp.json");
}

export function opencodeConfigPath(
  context: Pick<AdapterContext, "home" | "platform">,
): string {
  return path.join(context.home, ".config", "opencode", "opencode.json");
}

export function mcpConfigPath(
  agent: AgentId,
  context: Pick<AdapterContext, "home" | "platform">,
): string | undefined {
  if (agent === "codex") return codexConfigPath(context);
  if (agent === "claude-code") return claudeMcpConfigPath(context);
  if (agent === "opencode") return opencodeConfigPath(context);
  return undefined;
}

export async function readMcpServer(
  agent: AgentId,
  context: Pick<AdapterContext, "home" | "platform">,
  name: string,
): Promise<McpServerSpec | undefined> {
  const file = mcpConfigPath(agent, context);
  if (!file) return undefined;
  try {
    const content = await readFile(file, "utf8");
    if (agent === "codex") return parseCodexServer(content, name);
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return undefined;
    const root = parsed as Record<string, unknown>;
    if (agent === "claude-code") {
      const servers = root.mcpServers;
      if (!servers || typeof servers !== "object" || Array.isArray(servers))
        return undefined;
      const entry = (servers as Record<string, unknown>)[name];
      if (!entry || typeof entry !== "object" || Array.isArray(entry))
        return undefined;
      const record = entry as Record<string, unknown>;
      return {
        name,
        command: typeof record.command === "string" ? record.command : "",
        args: Array.isArray(record.args)
          ? record.args.filter(
              (item): item is string => typeof item === "string",
            )
          : [],
        env:
          record.env &&
          typeof record.env === "object" &&
          !Array.isArray(record.env)
            ? Object.fromEntries(
                Object.entries(record.env as Record<string, unknown>).filter(
                  (item): item is [string, string] =>
                    typeof item[1] === "string",
                ),
              )
            : undefined,
      };
    }
    const mcp = root.mcp;
    if (!mcp || typeof mcp !== "object" || Array.isArray(mcp)) return undefined;
    const entry = (mcp as Record<string, unknown>)[name];
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      return undefined;
    const record = entry as Record<string, unknown>;
    const commandValue = record.command;
    if (
      Array.isArray(commandValue) &&
      commandValue.every((item) => typeof item === "string")
    ) {
      const [command = "", ...args] = commandValue;
      return { name, command, args };
    }
    return {
      name,
      command: typeof record.command === "string" ? record.command : "",
      args: Array.isArray(record.args)
        ? record.args.filter((item): item is string => typeof item === "string")
        : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function registerCodex(
  spec: McpServerSpec,
  context: Pick<AdapterContext, "home">,
): Promise<McpRegisterResult> {
  const file = codexConfigPath(context);
  const existing = await readMcpServer(
    "codex",
    { ...context, platform: "linux" },
    spec.name,
  );
  if (existing && specsMatch(existing, spec)) {
    return {
      agent: "codex",
      status: "already",
      path: file,
      detail: "matches current configuration",
    };
  }
  let content = "";
  try {
    content = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (existing && !content.includes(MARKER_START)) {
    return {
      agent: "codex",
      status: "mismatch",
      path: file,
      detail:
        "user-managed [mcp_servers.headroom] entry outside Headroom markers; left untouched",
    };
  }
  const block = renderCodexBlock(spec);
  let next: string;
  if (content.includes(MARKER_START) && content.includes(MARKER_END)) {
    const start = content.indexOf(MARKER_START);
    const end = content.indexOf(MARKER_END) + MARKER_END.length;
    next = `${content.slice(0, start).replace(/\n*$/, "")}\n\n${block}\n${content.slice(end).replace(/^\n*/, "")}`;
  } else if (content.trim())
    next = `${content.replace(/\n*$/, "")}\n\n${block}\n`;
  else next = `${block}\n`;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, next, "utf8");
  return {
    agent: "codex",
    status: "registered",
    path: file,
    detail: `wrote ${file}`,
  };
}

async function registerClaude(
  spec: McpServerSpec,
  context: Pick<AdapterContext, "home">,
): Promise<McpRegisterResult> {
  const file = claudeMcpConfigPath(context);
  const existing = await readMcpServer(
    "claude-code",
    { ...context, platform: "linux" },
    spec.name,
  );
  if (existing && specsMatch(existing, spec)) {
    return {
      agent: "claude-code",
      status: "already",
      path: file,
      detail: "matches current configuration",
    };
  }
  if (existing) {
    return {
      agent: "claude-code",
      status: "mismatch",
      path: file,
      detail: "existing headroom MCP entry differs; left untouched",
    };
  }
  let current: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      current = parsed as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const servers =
    current.mcpServers &&
    typeof current.mcpServers === "object" &&
    !Array.isArray(current.mcpServers)
      ? { ...(current.mcpServers as Record<string, unknown>) }
      : {};
  const entry: Record<string, unknown> = { command: spec.command };
  if (spec.args.length) entry.args = spec.args;
  if (spec.env && Object.keys(spec.env).length) entry.env = spec.env;
  servers[spec.name] = entry;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    `${JSON.stringify({ ...current, mcpServers: servers }, null, 2)}\n`,
    "utf8",
  );
  return {
    agent: "claude-code",
    status: "registered",
    path: file,
    detail: `wrote ${file}`,
  };
}

async function registerOpencode(
  spec: McpServerSpec,
  context: Pick<AdapterContext, "home" | "platform">,
): Promise<McpRegisterResult> {
  const file = opencodeConfigPath(context);
  const existing = await readMcpServer("opencode", context, spec.name);
  if (existing && specsMatch(existing, spec)) {
    return {
      agent: "opencode",
      status: "already",
      path: file,
      detail: "matches current configuration",
    };
  }
  if (existing) {
    return {
      agent: "opencode",
      status: "mismatch",
      path: file,
      detail: "existing headroom MCP entry differs; left untouched",
    };
  }
  let current: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      current = parsed as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const mcp =
    current.mcp &&
    typeof current.mcp === "object" &&
    !Array.isArray(current.mcp)
      ? { ...(current.mcp as Record<string, unknown>) }
      : {};
  const entry: Record<string, unknown> = {
    type: "local",
    command: [spec.command, ...spec.args],
    enabled: true,
  };
  if (spec.env && Object.keys(spec.env).length) entry.environment = spec.env;
  mcp[spec.name] = entry;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    `${JSON.stringify({ ...current, mcp }, null, 2)}\n`,
    "utf8",
  );
  return {
    agent: "opencode",
    status: "registered",
    path: file,
    detail: `wrote ${file}`,
  };
}

export async function registerHeadroomMcp(
  agent: AgentId,
  spec: McpServerSpec,
  context: Pick<AdapterContext, "home" | "platform">,
): Promise<McpRegisterResult> {
  try {
    if (agent === "codex") return registerCodex(spec, context);
    if (agent === "claude-code") return registerClaude(spec, context);
    if (agent === "opencode") return registerOpencode(spec, context);
    return {
      agent,
      status: "unsupported",
      detail: `${agent} has no structured Headroom MCP registrar yet`,
    };
  } catch (error) {
    return {
      agent,
      status: "failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export type McpUnregisterStatus =
  "removed" | "absent" | "preserved" | "unsupported" | "failed";
export type McpUnregisterResult = {
  agent: AgentId;
  status: McpUnregisterStatus;
  path?: string | undefined;
  detail: string;
};

async function unregisterCodex(
  context: Pick<AdapterContext, "home">,
): Promise<McpUnregisterResult> {
  const file = codexConfigPath(context);
  let content = "";
  try {
    content = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return {
        agent: "codex",
        status: "absent",
        path: file,
        detail: "no config.toml",
      };
    throw error;
  }
  if (!content.includes(MARKER_START) || !content.includes(MARKER_END)) {
    return {
      agent: "codex",
      status: "preserved",
      path: file,
      detail: "no Don’t Waste Headroom markers; left untouched",
    };
  }
  const start = content.indexOf(MARKER_START);
  const end = content.indexOf(MARKER_END) + MARKER_END.length;
  const next =
    `${content.slice(0, start).replace(/\n*$/, "")}\n${content.slice(end).replace(/^\n*/, "")}`.replace(
      /\n{3,}/g,
      "\n\n",
    );
  await writeFile(file, next.endsWith("\n") ? next : `${next}\n`, "utf8");
  return {
    agent: "codex",
    status: "removed",
    path: file,
    detail: "removed marker-owned Headroom MCP block",
  };
}

async function unregisterClaude(
  context: Pick<AdapterContext, "home">,
): Promise<McpUnregisterResult> {
  const file = claudeMcpConfigPath(context);
  let current: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      current = parsed as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return {
        agent: "claude-code",
        status: "absent",
        path: file,
        detail: "no mcp.json",
      };
    throw error;
  }
  const servers =
    current.mcpServers &&
    typeof current.mcpServers === "object" &&
    !Array.isArray(current.mcpServers)
      ? { ...(current.mcpServers as Record<string, unknown>) }
      : {};
  if (!("headroom" in servers))
    return {
      agent: "claude-code",
      status: "absent",
      path: file,
      detail: "no headroom entry",
    };
  delete servers.headroom;
  await writeFile(
    file,
    `${JSON.stringify({ ...current, mcpServers: servers }, null, 2)}\n`,
    "utf8",
  );
  return {
    agent: "claude-code",
    status: "removed",
    path: file,
    detail: "removed headroom MCP entry",
  };
}

async function unregisterOpencode(
  context: Pick<AdapterContext, "home" | "platform">,
): Promise<McpUnregisterResult> {
  const file = opencodeConfigPath(context);
  let current: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      current = parsed as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return {
        agent: "opencode",
        status: "absent",
        path: file,
        detail: "no opencode.json",
      };
    throw error;
  }
  const mcp =
    current.mcp &&
    typeof current.mcp === "object" &&
    !Array.isArray(current.mcp)
      ? { ...(current.mcp as Record<string, unknown>) }
      : {};
  if (!("headroom" in mcp))
    return {
      agent: "opencode",
      status: "absent",
      path: file,
      detail: "no headroom entry",
    };
  delete mcp.headroom;
  await writeFile(
    file,
    `${JSON.stringify({ ...current, mcp }, null, 2)}\n`,
    "utf8",
  );
  return {
    agent: "opencode",
    status: "removed",
    path: file,
    detail: "removed headroom MCP entry",
  };
}

/** Remove only Don’t Waste–owned Headroom MCP entries; preserve user-managed configs. */
export async function unregisterHeadroomMcp(
  agent: AgentId,
  context: Pick<AdapterContext, "home" | "platform">,
): Promise<McpUnregisterResult> {
  try {
    if (agent === "codex") return unregisterCodex(context);
    if (agent === "claude-code") return unregisterClaude(context);
    if (agent === "opencode") return unregisterOpencode(context);
    return {
      agent,
      status: "unsupported",
      detail: `${agent} has no Headroom MCP unregistrar`,
    };
  } catch (error) {
    return {
      agent,
      status: "failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export function headroomMcpSpec(
  command: string,
  features: Record<string, boolean> = {},
): McpServerSpec {
  return {
    name: "headroom",
    command,
    args: ["mcp", "serve"],
    env: headroomFeatureEnv(features),
  };
}
