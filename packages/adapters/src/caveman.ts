import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentId, Mode } from "@dont-waste/catalog";
import { importCavemanStats } from "@dont-waste/telemetry";
import { BaseAdapter } from "./base.js";
import { findExecutable } from "./runtime.js";
import type {
  AdapterContext,
  DetectionResult,
  HealthCheck,
  InstallResult,
  MetricImportResult,
  OperationPlan,
  ToolSelection,
} from "./types.js";

/** Map Don’t Waste agents onto Caveman installer `--only` ids. */
export const cavemanOnlyId: Partial<Record<AgentId, string>> = {
  codex: "codex",
  "claude-code": "claude",
  "gemini-cli": "gemini",
  "copilot-cli": "copilot",
  "antigravity-cli": "antigravity",
  opencode: "opencode",
};

export function resolveCavemanMode(mode: Mode): string {
  if (mode === "off") return "full";
  return mode;
}

/** Marker files Don’t Waste owns. Never invent a default agent when none are selected (install-only). */
export function cavemanActivePaths(
  context: Pick<AdapterContext, "home" | "platform" | "selectedAgents">,
): string[] {
  const paths: string[] = [];
  if (context.selectedAgents.includes("claude-code")) {
    paths.push(path.join(context.home, ".claude", ".caveman-active"));
  }
  if (context.selectedAgents.includes("opencode")) {
    paths.push(
      path.join(context.home, ".config", "opencode", ".caveman-active"),
    );
  }
  return paths;
}

export function cavemanDetectPaths(home: string): string[] {
  return [
    path.join(home, ".claude", ".caveman-active"),
    path.join(home, ".config", "opencode", ".caveman-active"),
  ];
}

function installArgs(context: AdapterContext): string[] {
  const args = ["-y", "github:JuliusBrussee/caveman", "--"];
  const only = context.selectedAgents
    .map((agent) => cavemanOnlyId[agent])
    .filter((id): id is string => Boolean(id));
  if (only.length) {
    for (const id of only) args.push("--only", id);
  } else {
    args.push("--minimal");
  }
  args.push("--non-interactive");
  return args;
}

export class CavemanAdapter extends BaseAdapter {
  readonly id = "caveman" as const;

  async detect(context: AdapterContext): Promise<DetectionResult> {
    const node = await findExecutable("node");
    const markers: string[] = [];
    for (const file of cavemanDetectPaths(context.home)) {
      try {
        await access(file);
        markers.push(file);
      } catch {
        /* absent */
      }
    }
    if (!markers.length) {
      return {
        id: this.id,
        detected: false,
        warnings: [
          node
            ? "Caveman is not installed (no .caveman-active markers); Node.js is available for the official installer"
            : "Node.js 18+ is required by the official Caveman installer",
        ],
      };
    }
    return {
      id: this.id,
      detected: true,
      path: markers[0],
      warnings: node
        ? []
        : ["Caveman markers found but Node.js is absent from PATH"],
    };
  }

  async planInstall(
    selection: ToolSelection,
    context: AdapterContext,
  ): Promise<OperationPlan> {
    const unsupported = context.selectedAgents.filter(
      (agent) => !cavemanOnlyId[agent],
    );
    const mode = resolveCavemanMode(selection.mode);
    const affectedPaths = cavemanActivePaths(context);
    const alreadyActive = (
      await Promise.all(
        affectedPaths.map(async (file) => {
          try {
            return (await readFile(file, "utf8")).trim().length > 0;
          } catch {
            return false;
          }
        }),
      )
    ).some(Boolean);
    const commands =
      context.selectedAgents.length === 0 || alreadyActive
        ? []
        : [
            {
              command: "npx",
              args: installArgs(context),
              label: "Run the official Caveman installer for selected agents",
            },
          ];
    return this.basePlan(
      selection,
      context,
      commands,
      [
        context.selectedAgents.length === 0
          ? "install-only: Caveman binary/skills install may run, but Don’t Waste will not write agent marker files."
          : alreadyActive
            ? "Existing Caveman install detected; Don’t Waste will only refresh .caveman-active mode files."
            : `Caveman mode: ${mode}. Don’t Waste writes this into .caveman-active after install.`,
        "Caveman session savings are estimates and never enter the measured total.",
        selection.features.statusline
          ? "Statusline savings stay enabled (default Caveman behavior)."
          : "To silence the Claude Code savings badge later, set CAVEMAN_STATUSLINE_SAVINGS=0.",
        ...unsupported.map(
          (agent) => `${agent} has no Caveman --only target yet; skipped.`,
        ),
      ].filter(Boolean),
      affectedPaths,
    );
  }

  async install(
    plan: OperationPlan,
    context: AdapterContext,
  ): Promise<InstallResult> {
    const base = await super.install(plan, context);
    if (!base.succeeded || context.dryRun) return base;
    // install-only passes empty selectedAgents — never write global/agent markers.
    const markers = cavemanActivePaths(context);
    if (!markers.length) return base;
    const mode = resolveCavemanMode(plan.selection.mode);
    for (const file of markers) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, `${mode}\n`, "utf8");
    }
    return base;
  }

  async verify(
    selection: ToolSelection,
    context: AdapterContext,
  ): Promise<HealthCheck[]> {
    const node = await findExecutable("node");
    const checks: HealthCheck[] = [
      node
        ? {
            id: "caveman-node",
            status: "pass",
            message: `Node.js ${process.versions.node} is available for Caveman hooks`,
          }
        : {
            id: "caveman-node",
            status: "fail",
            message: "Node.js is absent from PATH",
            remediation: "Install Node.js 18+ and rerun init.",
          },
    ];
    const expected = resolveCavemanMode(selection.mode);
    const modeFiles = cavemanActivePaths(context);
    if (!modeFiles.length) {
      checks.push({
        id: "caveman-mode",
        status: "warn",
        message: "No Caveman mode file targets for the selected agents",
      });
      return checks;
    }
    for (const file of modeFiles) {
      try {
        const actual = (await readFile(file, "utf8")).trim();
        checks.push(
          actual === expected
            ? {
                id: `caveman-mode-${path.basename(path.dirname(file))}`,
                status: "pass",
                message: `${file} is ${expected}`,
              }
            : {
                id: `caveman-mode-${path.basename(path.dirname(file))}`,
                status: "fail",
                message: `${file} is ${actual || "(empty)"}, expected ${expected}`,
              },
        );
      } catch {
        checks.push({
          id: `caveman-mode-${path.basename(path.dirname(file))}`,
          status: "warn",
          message: `${file} is not readable yet; open an agent session or rerun init`,
        });
      }
    }
    return checks;
  }

  async collectMetrics(): Promise<MetricImportResult> {
    const statsFile = process.env.DONT_WASTE_CAVEMAN_STATS_FILE;
    if (!statsFile)
      return {
        source: "caveman-stats",
        events: [],
        error:
          "No explicit DONT_WASTE_CAVEMAN_STATS_FILE was configured; Don’t Waste does not scan agent conversations.",
      };
    try {
      await access(statsFile);
      return {
        source: "caveman-stats",
        events: importCavemanStats(await readFile(statsFile, "utf8")),
      };
    } catch (error) {
      return {
        source: "caveman-stats",
        events: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async uninstallPaths(context: AdapterContext): Promise<string[]> {
    const selected = context.selectedAgents.length
      ? cavemanActivePaths(context)
      : cavemanDetectPaths(context.home);
    return selected;
  }

  async uninstall(context: AdapterContext): Promise<InstallResult> {
    // Only remove Don’t Waste marker files; do not run the upstream uninstaller (would touch user-managed skills).
    const targets = await this.uninstallPaths(context);
    const errors: string[] = [];
    if (!context.dryRun) {
      for (const file of targets) {
        try {
          await rm(file, { force: true });
        } catch (error) {
          errors.push(
            `Failed to remove ${file}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
    return {
      succeeded: errors.length === 0,
      executed: [],
      skipped: context.dryRun
        ? targets.map((file) => ({
            command: "rm",
            args: [file],
            label: `Remove Caveman marker ${file}`,
          }))
        : [],
      errors,
    };
  }
}
