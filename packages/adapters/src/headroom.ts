import { execa } from "execa";
import { type AgentId } from "@dont-waste/catalog";
import { importHeadroomJson } from "@dont-waste/telemetry";
import { getAgentPaths } from "./agents.js";
import { BaseAdapter } from "./base.js";
import { headroomMcpSpec, mcpConfigPath, readMcpServer, registerHeadroomMcp, type McpRegisterResult } from "./mcp.js";
import { executableDetection, findExecutable } from "./runtime.js";
import type { AdapterContext, HealthCheck, InstallResult, MetricImportResult, OperationPlan, ToolSelection } from "./types.js";

const wrapName: Partial<Record<AgentId, string>> = { codex: "codex", "claude-code": "claude", "copilot-cli": "copilot", opencode: "opencode" };
const mcpAgents: AgentId[] = ["codex", "claude-code", "opencode"];

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
    const affectedPaths = [
      ...context.selectedAgents.flatMap((agent) => getAgentPaths(agent, context)),
      ...context.selectedAgents.map((agent) => mcpConfigPath(agent, context)).filter((file): file is string => Boolean(file)),
    ];
    return this.basePlan(selection, context, commands, [
      "Headroom wrap starts an interactive agent session and is intentionally not launched by the installer.",
      "Headroom MCP (stdio: `headroom mcp serve`) is merged into Codex/Claude/OpenCode configs when absent; existing mismatched entries are never replaced.",
      selection.features.outputShaper ? "HEADROOM_OUTPUT_SHAPER saves output through a counterfactual estimate unless a holdout is configured." : "",
    ].filter(Boolean), [...new Set(affectedPaths)]);
  }

  async install(plan: OperationPlan, context: AdapterContext): Promise<InstallResult> {
    const base = await super.install(plan, context);
    if (!base.succeeded || context.dryRun) return base;
    const headroomPath = await findExecutable("headroom", context.platform);
    if (!headroomPath) {
      return { ...base, succeeded: false, errors: [...base.errors, "Headroom binary not found on PATH after install; MCP registration skipped."] };
    }
    const spec = headroomMcpSpec(headroomPath);
    const mcpResults: McpRegisterResult[] = [];
    for (const agent of context.selectedAgents.filter((item) => mcpAgents.includes(item))) {
      mcpResults.push(await registerHeadroomMcp(agent, spec, context));
    }
    const failures = mcpResults.filter((item) => item.status === "failed");
    return {
      ...base,
      succeeded: failures.length === 0,
      errors: [...base.errors, ...failures.map((item) => `MCP ${item.agent}: ${item.detail}`)],
    };
  }

  async verify(selection: ToolSelection, context: AdapterContext): Promise<HealthCheck[]> {
    const detection = await this.detect(context);
    if (!detection.detected) return [{ id: "headroom-binary", status: "fail", message: "Headroom is not on PATH", remediation: "Install with uv tool install \"headroom-ai[all]\"." }];
    const checks: HealthCheck[] = [];
    try {
      const doctor = await execa("headroom", ["doctor"], { reject: false, timeout: 15_000 });
      checks.push({ id: "headroom-doctor", status: doctor.exitCode === 0 ? "pass" : "warn", message: doctor.exitCode === 0 ? "headroom doctor passed" : (doctor.stderr || doctor.stdout || "headroom doctor reported warnings") });
    } catch (error) {
      checks.push({ id: "headroom-doctor", status: "fail", message: `headroom doctor could not run: ${error instanceof Error ? error.message : String(error)}`, remediation: "Check that the resolved Headroom binary is executable." });
    }
    const headroomPath = detection.path ?? await findExecutable("headroom", context.platform);
    const expected = headroomPath ? headroomMcpSpec(headroomPath) : undefined;
    for (const agent of context.selectedAgents.filter((item) => mcpAgents.includes(item))) {
      if (!expected) {
        checks.push({ id: `headroom-mcp-${agent}`, status: "warn", message: `Cannot verify Headroom MCP for ${agent} without a resolved binary path` });
        continue;
      }
      const existing = await readMcpServer(agent, context, "headroom");
      if (!existing) {
        checks.push({ id: `headroom-mcp-${agent}`, status: "fail", message: `Headroom MCP is not configured for ${agent}`, remediation: "Rerun dont-waste init after Headroom is on PATH." });
      } else if (existing.command === expected.command && existing.args.join(" ") === expected.args.join(" ")) {
        checks.push({ id: `headroom-mcp-${agent}`, status: "pass", message: `Headroom MCP is configured for ${agent}` });
      } else {
        checks.push({ id: `headroom-mcp-${agent}`, status: "warn", message: `Headroom MCP for ${agent} exists but differs from the expected stdio command; left untouched` });
      }
    }
    return checks;
  }

  async collectMetrics(): Promise<MetricImportResult> {
    try {
      const result = await execa("headroom", ["perf", "--format", "json"], { reject: false, timeout: 15_000 });
      if (result.exitCode !== 0) return { source: "headroom perf", events: [], error: result.stderr || "headroom perf failed" };
      return { source: "headroom perf", events: importHeadroomJson(result.stdout) };
    } catch (error) { return { source: "headroom perf", events: [], error: error instanceof Error ? error.message : String(error) }; }
  }

  async uninstall(context: AdapterContext) {
    const plan = this.basePlan({ mode: "off", features: {} }, context, context.selectedAgents.flatMap((agent) => wrapName[agent] ? [{ command: "headroom", args: ["unwrap", wrapName[agent] as string], label: `Unwrap ${agent}` }] : []));
    return this.install(plan, context);
  }
}
