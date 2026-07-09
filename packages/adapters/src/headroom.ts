import { execa } from "execa";
import { type AgentId } from "@dont-waste/catalog";
import { importHeadroomJson } from "@dont-waste/telemetry";
import { getAgentPaths } from "./agents.js";
import { BaseAdapter } from "./base.js";
import { executableDetection, findExecutable } from "./runtime.js";
import type { AdapterContext, HealthCheck, MetricImportResult, OperationPlan, ToolSelection } from "./types.js";

const wrapName: Partial<Record<AgentId, string>> = { codex: "codex", "claude-code": "claude", "copilot-cli": "copilot", opencode: "opencode" };

export class HeadroomAdapter extends BaseAdapter {
  readonly id = "headroom" as const;

  detect(_context: AdapterContext): ReturnType<typeof executableDetection> { return executableDetection(this.id, "headroom"); }

  async planInstall(selection: ToolSelection, context: AdapterContext): Promise<OperationPlan> {
    const detected = await this.detect(context);
    const commands = [];
    if (!detected.detected) {
      const uv = await findExecutable("uv", context.platform);
      commands.push(uv
        ? { command: "uv", args: ["tool", "install", "headroom-ai[all]"], label: "Install Headroom with uv" }
        : { command: "python", args: ["-m", "pip", "install", "headroom-ai[all]"], label: "Install Headroom with pip" });
    }
    for (const agent of context.selectedAgents) {
      const wrapper = wrapName[agent];
      if (wrapper) commands.push({ command: "headroom", args: ["wrap", wrapper], label: `Launch ${agent} through Headroom`, interactive: true });
    }
    const affectedPaths = context.selectedAgents.flatMap((agent) => getAgentPaths(agent, context));
    return this.basePlan(context, commands, [
      "Headroom wrap starts an interactive agent session and is intentionally not launched by the installer.",
      "For MCP clients, use the absolute path reported by `command -v headroom` with `headroom mcp serve`; existing MCP entries are never replaced.",
      selection.features.outputShaper ? "HEADROOM_OUTPUT_SHAPER saves output through a counterfactual estimate unless a holdout is configured." : "",
    ].filter(Boolean), affectedPaths);
  }

  async verify(_selection: ToolSelection): Promise<HealthCheck[]> {
    const detection = await this.detect({} as AdapterContext);
    if (!detection.detected) return [{ id: "headroom-binary", status: "fail", message: "Headroom is not on PATH", remediation: "Install with uv tool install \"headroom-ai[all]\"." }];
    try {
      const doctor = await execa("headroom", ["doctor"], { reject: false, timeout: 15_000 });
      return [{ id: "headroom-doctor", status: doctor.exitCode === 0 ? "pass" : "warn", message: doctor.exitCode === 0 ? "headroom doctor passed" : (doctor.stderr || doctor.stdout || "headroom doctor reported warnings") }];
    } catch (error) {
      return [{ id: "headroom-doctor", status: "fail", message: `headroom doctor could not run: ${error instanceof Error ? error.message : String(error)}`, remediation: "Check that the resolved Headroom binary is executable." }];
    }
  }

  async collectMetrics(): Promise<MetricImportResult> {
    try {
      const result = await execa("headroom", ["perf", "--format", "json"], { reject: false, timeout: 15_000 });
      if (result.exitCode !== 0) return { source: "headroom perf", events: [], error: result.stderr || "headroom perf failed" };
      return { source: "headroom perf", events: importHeadroomJson(result.stdout) };
    } catch (error) { return { source: "headroom perf", events: [], error: error instanceof Error ? error.message : String(error) }; }
  }

  async uninstall(context: AdapterContext) {
    const plan = this.basePlan(context, context.selectedAgents.flatMap((agent) => wrapName[agent] ? [{ command: "headroom", args: ["unwrap", wrapName[agent] as string], label: `Unwrap ${agent}` }] : []));
    return this.install(plan, context);
  }
}
