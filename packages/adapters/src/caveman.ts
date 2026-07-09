import { access, readFile } from "node:fs/promises";
import { execa } from "execa";
import { importCavemanStats } from "@dont-waste/telemetry";
import { BaseAdapter } from "./base.js";
import { findExecutable } from "./runtime.js";
import type { AdapterContext, DetectionResult, HealthCheck, MetricImportResult, OperationPlan, ToolSelection } from "./types.js";

export class CavemanAdapter extends BaseAdapter {
  readonly id = "caveman" as const;

  async detect(_context: AdapterContext): Promise<DetectionResult> {
    const node = await findExecutable("node");
    return node
      ? { id: this.id, detected: true, path: node, version: process.versions.node, warnings: [] }
      : { id: this.id, detected: false, warnings: ["Node.js 18+ is required by the official Caveman installer"] };
  }

  async planInstall(selection: ToolSelection, context: AdapterContext): Promise<OperationPlan> {
    const command = context.platform === "win32"
      ? { command: "powershell", args: ["-NoProfile", "-Command", "irm https://raw.githubusercontent.com/JuliusBrussee/caveman/main/install.ps1 | iex"], label: "Run the official Caveman installer" }
      : { command: "bash", args: ["-c", "curl -fsSL https://raw.githubusercontent.com/JuliusBrussee/caveman/main/install.sh | bash"], label: "Run the official Caveman installer" };
    return this.basePlan(context, [command], [
      `Caveman mode: ${selection.mode}. It reduces output verbosity; its own instruction context can make already terse sessions net-negative.`,
      "Caveman session savings are estimates and never enter the measured total.",
      selection.features.statusline ? "CAVEMAN_STATUSLINE_SAVINGS remains enabled." : "",
    ].filter(Boolean));
  }

  async verify(_selection: ToolSelection): Promise<HealthCheck[]> {
    const node = await findExecutable("node");
    return node
      ? [{ id: "caveman-node", status: "pass", message: `Node.js ${process.versions.node} is available for Caveman hooks` }, { id: "caveman-agent", status: "warn", message: "Open a newly installed agent session and use /caveman-stats to confirm its upstream integration." }]
      : [{ id: "caveman-node", status: "fail", message: "Node.js is absent from PATH", remediation: "Install Node.js 18+ and rerun init." }];
  }

  async collectMetrics(): Promise<MetricImportResult> {
    const statsFile = process.env.DONT_WASTE_CAVEMAN_STATS_FILE;
    if (!statsFile) return { source: "caveman-stats", events: [], error: "No explicit DONT_WASTE_CAVEMAN_STATS_FILE was configured; Don’t Waste does not scan agent conversations." };
    try {
      await access(statsFile);
      return { source: "caveman-stats", events: importCavemanStats(await readFile(statsFile, "utf8")) };
    } catch (error) { return { source: "caveman-stats", events: [], error: error instanceof Error ? error.message : String(error) }; }
  }

  async uninstall(context: AdapterContext) {
    const command = context.platform === "win32"
      ? { command: "powershell", args: ["-NoProfile", "-Command", "irm https://raw.githubusercontent.com/JuliusBrussee/caveman/main/install.ps1 | iex -- --uninstall"], label: "Run the official Caveman uninstaller" }
      : { command: "bash", args: ["-c", "curl -fsSL https://raw.githubusercontent.com/JuliusBrussee/caveman/main/install.sh | bash -s -- --uninstall"], label: "Run the official Caveman uninstaller" };
    return this.install(this.basePlan(context, [command]), context);
  }
}
