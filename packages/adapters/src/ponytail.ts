import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentId, Mode } from "@dont-waste/catalog";
import { getAgentPaths, ponytailConfigPath } from "./agents.js";
import { BaseAdapter } from "./base.js";
import { executableDetection, findExecutable } from "./runtime.js";
import type { AdapterContext, Command, HealthCheck, InstallResult, MetricImportResult, OperationPlan, ToolSelection } from "./types.js";

const repository = "DietrichGebert/ponytail";

/** Ponytail only accepts lite/full/ultra; map unsupported catalog modes to full. */
export function resolvePonytailMode(mode: Mode): "lite" | "full" | "ultra" {
  if (mode === "lite" || mode === "ultra") return mode;
  return "full";
}

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

function uninstallCommandsFor(agent: AgentId): Command[] {
  if (agent === "codex") return [{ command: "codex", args: ["plugin", "remove", "ponytail"], label: "Remove Ponytail from Codex" }];
  if (agent === "claude-code") return [{ command: "claude", args: ["plugin", "remove", "ponytail"], label: "Remove Ponytail from Claude Code" }];
  if (agent === "pi") return [{ command: "pi", args: ["uninstall", "ponytail"], label: "Remove Ponytail from Pi" }];
  if (agent === "gemini-cli") return [{ command: "gemini", args: ["extensions", "uninstall", "ponytail"], label: "Remove Ponytail Gemini extension" }];
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
    const mode = resolvePonytailMode(selection.mode);
    return this.basePlan(selection, context, commands, [
      `Ponytail default mode: ${mode}. It keeps validation, error handling, security, and accessibility intact.`,
      "Codex hook approval is intentionally manual: Don’t Waste will not trust hooks on your behalf.",
      context.selectedAgents.includes("opencode") ? "OpenCode receives @dietrichgebert/ponytail in opencode.json during install." : "",
    ].filter(Boolean), affectedPaths);
  }

  async install(plan: OperationPlan, context: AdapterContext) {
    const base = await super.install(plan, context);
    if (!base.succeeded || context.dryRun) return base;
    const configFile = ponytailConfigPath(context);
    const defaultMode = resolvePonytailMode(plan.selection.mode);
    await updateJson(configFile, (value) => ({ ...value, defaultMode }));
    if (context.selectedAgents.includes("opencode")) {
      const config = getAgentPaths("opencode", context)[0];
      if (config) await updateJson(config, (value) => {
        const existing = Array.isArray(value.plugin) ? value.plugin.filter((item): item is string => typeof item === "string") : [];
        return { ...value, plugin: [...new Set([...existing, "@dietrichgebert/ponytail"])] };
      });
    }
    return base;
  }

  async verify(selection: ToolSelection, context: AdapterContext): Promise<HealthCheck[]> {
    const node = await findExecutable("node", context.platform);
    const expectedMode = resolvePonytailMode(selection.mode);
    const checks: HealthCheck[] = [node
      ? { id: "ponytail-node", status: "pass", message: "Node.js is on PATH for Ponytail hooks" }
      : { id: "ponytail-node", status: "warn", message: "Ponytail skills can load, but always-on hooks need Node.js on non-interactive PATH." }];
    try {
      const config = JSON.parse(await readFile(ponytailConfigPath(context), "utf8")) as { defaultMode?: unknown };
      checks.push(config.defaultMode === expectedMode
        ? { id: "ponytail-mode", status: "pass", message: `Ponytail defaultMode is ${expectedMode}` }
        : { id: "ponytail-mode", status: "fail", message: `Ponytail defaultMode is ${String(config.defaultMode)}, expected ${expectedMode}` });
    } catch {
      checks.push({ id: "ponytail-mode", status: "warn", message: "Ponytail config.json is not readable yet" });
    }
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

  async uninstall(context: AdapterContext): Promise<InstallResult> {
    const commands = context.selectedAgents.flatMap(uninstallCommandsFor);
    const plan = this.basePlan({ mode: "off", features: {} }, context, commands, [
      "Marketplace/extension removals that lack a stable CLI remain manual.",
    ]);
    const base = await super.install(plan, context);
    if (!context.dryRun) {
      if (context.selectedAgents.includes("opencode")) {
        const config = getAgentPaths("opencode", context)[0];
        if (config) await updateJson(config, (value) => ({ ...value, plugin: Array.isArray(value.plugin) ? value.plugin.filter((item) => item !== "@dietrichgebert/ponytail") : [] }));
      }
      try { await rm(ponytailConfigPath(context), { force: true }); } catch { /* ignore */ }
      try { await rm(path.join(context.home, ".claude", ".ponytail-active"), { force: true }); } catch { /* ignore */ }
    }
    const manual = context.selectedAgents.filter((agent) => !uninstallCommandsFor(agent).length && agent !== "opencode");
    return {
      ...base,
      errors: [
        ...base.errors,
        ...manual.map((agent) => `${agent}: remove Ponytail via that agent’s plugin/extension manager if still present`),
      ],
    };
  }
}
