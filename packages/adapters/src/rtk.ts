import { execa } from "execa";
import type { AgentId } from "@dont-waste/catalog";
import { importRtkJson } from "@dont-waste/telemetry";
import { BaseAdapter } from "./base.js";
import { executableDetection } from "./runtime.js";
import type { AdapterContext, HealthCheck, MetricImportResult, OperationPlan, ToolSelection } from "./types.js";

function rtkInitArgs(agent: AgentId): string[] {
  if (agent === "codex") return ["init", "-g", "--codex"];
  if (agent === "gemini-cli") return ["init", "-g", "--gemini"];
  if (agent === "antigravity-cli") return ["init", "--agent", "antigravity"];
  if (agent === "pi") return ["init", "-g", "--agent", "pi"];
  return ["init", "-g"];
}

export class RtkAdapter extends BaseAdapter {
  readonly id = "rtk" as const;
  detect(_context: AdapterContext): ReturnType<typeof executableDetection> { return executableDetection(this.id, "rtk"); }

  async planInstall(selection: ToolSelection, context: AdapterContext): Promise<OperationPlan> {
    const detected = await this.detect(context);
    const commands = [];
    if (!detected.detected) {
      if (context.platform === "darwin") commands.push({ command: "brew", args: ["install", "rtk"], label: "Install RTK with Homebrew" });
      else if (context.platform === "win32") commands.push({ command: "powershell", args: ["-NoProfile", "-Command", "irm https://raw.githubusercontent.com/rtk-ai/rtk/main/install.ps1 | iex"], label: "Install RTK from its official installer" });
      else commands.push({ command: "sh", args: ["-c", "curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/main/install.sh | sh"], label: "Install RTK from its official installer" });
    }
    for (const agent of context.selectedAgents) commands.push({ command: "rtk", args: rtkInitArgs(agent), label: `Enable RTK hook for ${agent}` });
    return this.basePlan(context, commands, [
      selection.features.ultraCompact ? "RTK ultra-compact is enabled for direct RTK commands; agent hooks stay command-aware." : "",
      "RTK hooks only rewrite shell/Bash calls. Built-in agent read tools can bypass RTK.",
    ].filter(Boolean));
  }

  async verify(): Promise<HealthCheck[]> {
    const detection = await this.detect({} as AdapterContext);
    if (!detection.detected) return [{ id: "rtk-binary", status: "fail", message: "RTK is not on PATH", remediation: "Install the official RTK release and run rtk init." }];
    try {
      const gain = await execa("rtk", ["gain", "--all", "--format", "json"], { reject: false, timeout: 15_000 });
      return [{ id: "rtk-gain", status: gain.exitCode === 0 ? "pass" : "warn", message: gain.exitCode === 0 ? "rtk gain is available" : "rtk is installed but gain data is not available yet" }];
    } catch (error) { return [{ id: "rtk-gain", status: "fail", message: `rtk gain could not run: ${error instanceof Error ? error.message : String(error)}` }]; }
  }

  async collectMetrics(): Promise<MetricImportResult> {
    try {
      const result = await execa("rtk", ["gain", "--all", "--format", "json"], { reject: false, timeout: 15_000 });
      if (result.exitCode !== 0) return { source: "rtk gain", events: [], error: result.stderr || "rtk gain failed" };
      return { source: "rtk gain", events: importRtkJson(result.stdout) };
    } catch (error) { return { source: "rtk gain", events: [], error: error instanceof Error ? error.message : String(error) }; }
  }

  async uninstall(context: AdapterContext) {
    return { succeeded: true, executed: [], skipped: [], errors: ["RTK has no stable generic uninstall command. Restore the recorded configuration snapshot with dont-waste rollback."] };
  }
}
