import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentId } from "@dont-waste/catalog";
import { getAgentPaths, ponytailConfigPath } from "./agents.js";
import { BaseAdapter } from "./base.js";
import { executableDetection, findExecutable } from "./runtime.js";
import type { AdapterContext, Command, HealthCheck, MetricImportResult, OperationPlan, ToolSelection } from "./types.js";

const repository = "DietrichGebert/ponytail";

function commandsFor(agent: AgentId): Command[] {
  if (agent === "codex") return [
    { command: "codex", args: ["plugin", "marketplace", "add", repository], label: "Add Ponytail marketplace to Codex" },
    { command: "codex", args: [], label: "Use /plugins to install Ponytail, then /hooks to review and trust its lifecycle hooks", interactive: true },
  ];
  if (agent === "claude-code") return [
    { command: "claude", args: ["plugin", "marketplace", "add", repository], label: "Add Ponytail marketplace to Claude Code" },
    { command: "claude", args: ["plugin", "install", "ponytail@ponytail"], label: "Install Ponytail in Claude Code" },
  ];
  if (agent === "copilot-cli") return [
    { command: "copilot", args: ["plugin", "marketplace", "add", repository], label: "Add Ponytail marketplace to Copilot CLI" },
    { command: "copilot", args: ["plugin", "install", "ponytail@ponytail"], label: "Install Ponytail in Copilot CLI" },
  ];
  if (agent === "gemini-cli") return [{ command: "gemini", args: ["extensions", "install", "https://github.com/DietrichGebert/ponytail"], label: "Install Ponytail Gemini extension" }];
  if (agent === "antigravity-cli") return [{ command: "agy", args: ["plugin", "install", "https://github.com/DietrichGebert/ponytail"], label: "Install Ponytail Antigravity extension" }];
  if (agent === "pi") return [{ command: "pi", args: ["install", "git:github.com/DietrichGebert/ponytail"], label: "Install Ponytail in Pi" }];
  return [];
}

async function updateJson(file: string, transform: (value: Record<string, unknown>) => Record<string, unknown>): Promise<void> {
  let current: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) current = parsed as Record<string, unknown>;
    else throw new Error("configuration root is not an object");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(transform(current), null, 2)}\n`, "utf8");
}

export class PonytailAdapter extends BaseAdapter {
  readonly id = "ponytail" as const;
  async detect(_context: AdapterContext) { return executableDetection(this.id, "node"); }

  async planInstall(selection: ToolSelection, context: AdapterContext): Promise<OperationPlan> {
    const commands = context.selectedAgents.flatMap(commandsFor);
    const affectedPaths = [ponytailConfigPath(context), ...context.selectedAgents.flatMap((agent) => getAgentPaths(agent, context))];
    return this.basePlan(context, commands, [
      `Ponytail default mode: ${selection.mode === "wenyan" ? "full" : selection.mode}. It keeps validation, error handling, security, and accessibility intact.`,
      "Codex hook approval is intentionally manual: Don’t Waste will not trust hooks on your behalf.",
    ], affectedPaths);
  }

  async install(plan: OperationPlan, context: AdapterContext) {
    const base = await super.install(plan, context);
    if (!base.succeeded || context.dryRun) return base;
    const configFile = ponytailConfigPath(context);
    await updateJson(configFile, (value) => ({ ...value, defaultMode: "full" }));
    if (context.selectedAgents.includes("opencode")) {
      const config = getAgentPaths("opencode", context)[0];
      if (config) await updateJson(config, (value) => {
        const existing = Array.isArray(value.plugin) ? value.plugin.filter((item): item is string => typeof item === "string") : [];
        return { ...value, plugin: [...new Set([...existing, "@dietrichgebert/ponytail"])] };
      });
    }
    return base;
  }

  async verify(_selection: ToolSelection, context: AdapterContext): Promise<HealthCheck[]> {
    const node = await findExecutable("node", context.platform);
    const checks: HealthCheck[] = [node
      ? { id: "ponytail-node", status: "pass", message: "Node.js is on PATH for Ponytail hooks" }
      : { id: "ponytail-node", status: "warn", message: "Ponytail skills can load, but always-on hooks need Node.js on non-interactive PATH." }];
    if (context.selectedAgents.includes("opencode")) {
      const file = getAgentPaths("opencode", context)[0];
      try {
        const config = file ? JSON.parse(await readFile(file, "utf8")) as { plugin?: unknown } : {};
        checks.push(Array.isArray(config.plugin) && config.plugin.includes("@dietrichgebert/ponytail")
          ? { id: "ponytail-opencode", status: "pass", message: "OpenCode Ponytail plugin is configured" }
          : { id: "ponytail-opencode", status: "fail", message: "OpenCode Ponytail plugin is missing" });
      } catch { checks.push({ id: "ponytail-opencode", status: "warn", message: "OpenCode configuration is not readable yet" }); }
    }
    return checks;
  }

  async collectMetrics(): Promise<MetricImportResult> {
    return { source: "ponytail", events: [], error: "Ponytail has no operational token telemetry; upstream benchmarks remain reference-only." };
  }

  async uninstall(context: AdapterContext) {
    if (!context.dryRun && context.selectedAgents.includes("opencode")) {
      const config = getAgentPaths("opencode", context)[0];
      if (config) await updateJson(config, (value) => ({ ...value, plugin: Array.isArray(value.plugin) ? value.plugin.filter((item) => item !== "@dietrichgebert/ponytail") : [] }));
    }
    return { succeeded: true, executed: [], skipped: [], errors: ["Plugin marketplace removals remain agent-specific. Use the agent’s plugin manager, then restore the recorded snapshot if needed."] };
  }
}
