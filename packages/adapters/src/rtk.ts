import { trackInFlight } from "@dont-waste/core";
import path from "node:path";
import { execa } from "execa";
import type { AgentId } from "@dont-waste/catalog";
import { importRtkJson } from "@dont-waste/telemetry";
import { BaseAdapter } from "./base.js";
import {
  installRtkFromOfficialRelease,
  resolveRtkTarget,
} from "./rtk-release.js";
import {
  executableDetection,
  findExecutable,
  runCommand,
  commandHooksFromAdapterContext,
} from "./runtime.js";
import type {
  AdapterContext,
  Command,
  HealthCheck,
  InstallResult,
  MetricImportResult,
  OperationPlan,
  ToolSelection,
} from "./types.js";

/** Official RTK init flags from https://github.com/rtk-ai/rtk README. */
export function rtkInitArgs(agent: AgentId): string[] {
  if (agent === "codex") return ["init", "-g", "--codex"];
  if (agent === "claude-code") return ["init", "-g"];
  if (agent === "copilot-cli") return ["init", "-g", "--copilot"];
  if (agent === "antigravity-cli") return ["init", "--agent", "antigravity"];
  if (agent === "opencode") return ["init", "-g", "--opencode"];
  if (agent === "pi") return ["init", "-g", "--agent", "pi"];
  return ["init", "-g"];
}

const RTK_RELEASE_LABEL =
  "Install RTK from official GitHub release with SHA-256 verification";

export { RTK_RELEASE_LABEL };

export class RtkAdapter extends BaseAdapter {
  readonly id = "rtk" as const;
  detect(context: AdapterContext): ReturnType<typeof executableDetection> {
    return executableDetection(this.id, "rtk", context.abortSignal);
  }

  async planInstall(
    selection: ToolSelection,
    context: AdapterContext,
  ): Promise<OperationPlan> {
    const detected = await this.detect(context);
    const commands: Command[] = [];
    const affectedPaths: string[] = [];
    if (!detected.detected) {
      if (
        context.platform === "darwin" &&
        (await findExecutable("brew", context.platform, context.abortSignal))
      ) {
        commands.push({
          command: "brew",
          args: ["install", "rtk"],
          label: "Install RTK with Homebrew",
          env: { HOMEBREW_NO_AUTO_UPDATE: "1", NONINTERACTIVE: "1" },
          timeoutMs: 300_000,
          forceKillAfterDelay: 5_000,
        });
      } else {
        const target = resolveRtkTarget(context.platform);
        commands.push({
          command: "dont-waste-internal",
          args: ["rtk-release-install", target.asset],
          label: RTK_RELEASE_LABEL,
        });
        const binaryName = context.platform === "win32" ? "rtk.exe" : "rtk";
        affectedPaths.push(
          path.join(context.home, ".local", "bin", binaryName),
        );
      }
    }
    for (const agent of context.selectedAgents) {
      commands.push({
        command: "rtk",
        args: rtkInitArgs(agent),
        label: `Enable RTK hook for ${agent}`,
        // Avoid rtk init telemetry consent hang during orchestrated apply.
        // Users can still opt in later via `rtk telemetry enable`.
        env: { RTK_TELEMETRY_DISABLED: "1" },
        timeoutMs: 120_000,
        forceKillAfterDelay: 5_000,
      });
    }
    return this.basePlan(
      selection,
      context,
      commands,
      [
        selection.features.ultraCompact
          ? "RTK ultra-compact is enabled for direct RTK commands; agent hooks stay command-aware."
          : "",
        "Non-Homebrew installs download the official GitHub release asset and refuse to continue on checksum mismatch or download timeout.",
        "RTK hooks only rewrite shell/Bash calls. Built-in agent read tools can bypass RTK.",
      ].filter(Boolean),
      affectedPaths,
    );
  }

  async install(
    plan: OperationPlan,
    context: AdapterContext,
  ): Promise<InstallResult> {
    const executed: Command[] = [];
    const skipped: Command[] = [];
    const errors: string[] = [];
    for (const command of plan.commands) {
      if (command.label === RTK_RELEASE_LABEL) {
        await context.beforeCommand?.(command);
        if (context.dryRun) {
          skipped.push(command);
          continue;
        }
        if (context.abortSignal?.aborted) {
          executed.push(command);
          errors.push(`${command.label} aborted before completion`);
          break;
        }
        try {
          const installed = await installRtkFromOfficialRelease({
            platform: context.platform,
            dryRun: false,
            abortSignal: context.abortSignal,
          });
          executed.push(command);
          if (
            !(await findExecutable(
              "rtk",
              context.platform,
              context.abortSignal,
            ))
          ) {
            errors.push(
              `RTK installed to ${installed.binaryPath} but is not on PATH. Add ~/.local/bin to PATH and rerun.`,
            );
            break;
          }
        } catch (error) {
          executed.push(command);
          errors.push(error instanceof Error ? error.message : String(error));
          break;
        }
        continue;
      }
      const result = await runCommand(
        command,
        context.dryRun,
        commandHooksFromAdapterContext(context),
      );
      if (result.ran) executed.push(command);
      else skipped.push(command);
      if (result.error) {
        errors.push(result.error);
        break;
      }
    }
    return { succeeded: errors.length === 0, executed, skipped, errors };
  }

  async verify(
    _selection: ToolSelection,
    context: AdapterContext,
  ): Promise<HealthCheck[]> {
    const detection = await this.detect(context);
    if (!detection.detected) {
      return [
        {
          id: "rtk-binary",
          status: "fail",
          message: "RTK is not on PATH",
          remediation: "Install the official RTK release and run rtk init.",
        },
      ];
    }
    const checks: HealthCheck[] = [
      {
        id: "rtk-binary",
        status: "pass",
        message: `RTK binary found${detection.version ? ` (${detection.version})` : ""}`,
      },
    ];
    try {
      const gain = await trackInFlight(
        execa("rtk", ["gain", "--all", "--format", "json"], {
          reject: false,
          timeout: 15_000,
          forceKillAfterDelay: 5_000,
          ...(context.abortSignal ? { cancelSignal: context.abortSignal } : {}),
        }),
      );
      checks.push({
        id: "rtk-gain",
        status: gain.exitCode === 0 ? "pass" : "warn",
        message:
          gain.exitCode === 0
            ? "rtk gain is available"
            : "rtk is installed but gain data is not available yet",
      });
    } catch (error) {
      checks.push({
        id: "rtk-gain",
        status: "fail",
        message: `rtk gain could not run: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
    return checks;
  }

  async collectMetrics(context: AdapterContext): Promise<MetricImportResult> {
    try {
      const result = await trackInFlight(
        execa("rtk", ["gain", "--all", "--format", "json"], {
          reject: false,
          timeout: 15_000,
          forceKillAfterDelay: 5_000,
          ...(context.abortSignal ? { cancelSignal: context.abortSignal } : {}),
        }),
      );
      if (result.exitCode !== 0)
        return {
          source: "rtk gain",
          events: [],
          error: result.stderr || "rtk gain failed",
        };
      return { source: "rtk gain", events: importRtkJson(result.stdout) };
    } catch (error) {
      return {
        source: "rtk gain",
        events: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async uninstallPaths(): Promise<string[]> {
    return [];
  }

  async uninstall(_context: AdapterContext) {
    return {
      succeeded: true,
      executed: [],
      skipped: [
        {
          command: "rtk",
          args: ["uninstall"],
          label:
            "RTK has no stable generic uninstall; use dont-waste rollback for snapshots",
        },
      ],
      errors: [],
    };
  }
}
