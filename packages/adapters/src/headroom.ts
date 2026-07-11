import { trackInFlight } from "@dont-waste/core";
import { execa } from "execa";
import { type AgentId } from "@dont-waste/catalog";
import { importHeadroomJson } from "@dont-waste/telemetry";
import {
  HEADROOM_CCR_TTL_SECONDS_VALUE,
  pendingAdvancedControlNotes,
} from "./advanced-controls.js";
import { getAgentPaths } from "./agents.js";
import { BaseAdapter } from "./base.js";
import {
  headroomMcpSpec,
  mcpConfigPath,
  readMcpServer,
  registerHeadroomMcp,
  unregisterHeadroomMcp,
  type McpRegisterResult,
} from "./mcp.js";
import { executableDetection, findExecutable } from "./runtime.js";
import type {
  AdapterContext,
  HealthCheck,
  InstallResult,
  MetricImportResult,
  OperationPlan,
  ToolSelection,
} from "./types.js";

const wrapName: Partial<Record<AgentId, string>> = {
  codex: "codex",
  "claude-code": "claude",
  "copilot-cli": "copilot",
  opencode: "opencode",
};
const mcpAgents: AgentId[] = ["codex", "claude-code", "opencode"];

export class HeadroomAdapter extends BaseAdapter {
  readonly id = "headroom" as const;

  detect(context: AdapterContext): ReturnType<typeof executableDetection> {
    return executableDetection(this.id, "headroom", context.abortSignal);
  }

  async planInstall(
    selection: ToolSelection,
    context: AdapterContext,
  ): Promise<OperationPlan> {
    const detected = await this.detect(context);
    const commands = [];
    if (!detected.detected) {
      const uv = await findExecutable(
        "uv",
        context.platform,
        context.abortSignal,
      );
      commands.push(
        uv
          ? {
              command: "uv",
              args: ["tool", "install", "headroom-ai[all]"],
              label: "Install Headroom with uv",
              env: { UV_NO_PROGRESS: "1" },
              timeoutMs: 300_000,
              forceKillAfterDelay: 5_000,
            }
          : {
              command: "python",
              args: ["-m", "pip", "install", "headroom-ai[all]"],
              label: "Install Headroom with pip",
              env: { PIP_DISABLE_PIP_VERSION_CHECK: "1", PIP_NO_INPUT: "1" },
              timeoutMs: 300_000,
              forceKillAfterDelay: 5_000,
            },
      );
    }
    for (const agent of context.selectedAgents) {
      const wrapper = wrapName[agent];
      if (wrapper)
        commands.push({
          command: "headroom",
          args: ["wrap", wrapper],
          label: `Launch ${agent} through Headroom`,
          interactive: true,
          optional: true,
        });
    }
    const affectedPaths = [
      ...context.selectedAgents.flatMap((agent) =>
        getAgentPaths(agent, context),
      ),
      ...context.selectedAgents
        .map((agent) => mcpConfigPath(agent, context))
        .filter((file): file is string => Boolean(file)),
    ];
    const unsupportedMcp = context.selectedAgents.filter(
      (agent) => !mcpAgents.includes(agent) && !wrapName[agent],
    );
    const wrapOnly = context.selectedAgents.filter(
      (agent) => wrapName[agent] && !mcpAgents.includes(agent),
    );
    return this.basePlan(
      selection,
      context,
      commands,
      [
        "Headroom wrap starts an interactive agent session and is intentionally not launched by the installer.",
        "Headroom MCP (stdio: `headroom mcp serve`) is merged into Codex/Claude/OpenCode configs when absent; existing mismatched entries are never replaced.",
        ...unsupportedMcp.map(
          (agent) =>
            `${agent}: no Headroom wrap wrapper or structured MCP registrar yet; skipped.`,
        ),
        ...wrapOnly.map(
          (agent) =>
            `${agent}: Headroom wrap is available; structured MCP registration is not supported for this agent yet.`,
        ),
        selection.features.outputShaper
          ? "HEADROOM_OUTPUT_SHAPER=1 will be written into marker-owned Headroom MCP env (estimated savings without holdout)."
          : "",
        selection.features.ccrTtl
          ? `HEADROOM_CCR_TTL_SECONDS=${HEADROOM_CCR_TTL_SECONDS_VALUE} will be written into marker-owned Headroom MCP env for longer CCR retention.`
          : "",
        ...pendingAdvancedControlNotes(["headroom"]),
      ].filter(Boolean),
      [...new Set(affectedPaths)],
    );
  }

  async install(
    plan: OperationPlan,
    context: AdapterContext,
  ): Promise<InstallResult> {
    const base = await super.install(plan, context);
    if (!base.succeeded || context.dryRun) return base;
    const headroomPath = await findExecutable(
      "headroom",
      context.platform,
      context.abortSignal,
    );
    if (!headroomPath) {
      return {
        ...base,
        succeeded: false,
        errors: [
          ...base.errors,
          "Headroom binary not found on PATH after install; MCP registration skipped.",
        ],
      };
    }
    const spec = headroomMcpSpec(headroomPath, plan.selection.features);
    const mcpResults: McpRegisterResult[] = [];
    for (const agent of context.selectedAgents.filter((item) =>
      mcpAgents.includes(item),
    )) {
      mcpResults.push(await registerHeadroomMcp(agent, spec, context));
    }
    const failures = mcpResults.filter((item) => item.status === "failed");
    return {
      ...base,
      succeeded: failures.length === 0,
      errors: [
        ...base.errors,
        ...failures.map((item) => `MCP ${item.agent}: ${item.detail}`),
      ],
    };
  }

  async verify(
    selection: ToolSelection,
    context: AdapterContext,
  ): Promise<HealthCheck[]> {
    const detection = await this.detect(context);
    if (!detection.detected)
      return [
        {
          id: "headroom-binary",
          status: "fail",
          message: "Headroom is not on PATH",
          remediation: 'Install with uv tool install "headroom-ai[all]".',
        },
      ];
    const checks: HealthCheck[] = [];
    try {
      const doctor = await trackInFlight(
        execa("headroom", ["doctor"], {
          reject: false,
          timeout: 15_000,
          forceKillAfterDelay: 5_000,
          ...(context.abortSignal ? { cancelSignal: context.abortSignal } : {}),
        }),
      );
      checks.push({
        id: "headroom-doctor",
        status: doctor.exitCode === 0 ? "pass" : "warn",
        message:
          doctor.exitCode === 0
            ? "headroom doctor passed"
            : doctor.stderr ||
              doctor.stdout ||
              "headroom doctor reported warnings",
      });
    } catch (error) {
      checks.push({
        id: "headroom-doctor",
        status: "fail",
        message: `headroom doctor could not run: ${error instanceof Error ? error.message : String(error)}`,
        remediation: "Check that the resolved Headroom binary is executable.",
      });
    }
    const headroomPath =
      detection.path ?? (await findExecutable("headroom", context.platform));
    const expected = headroomPath
      ? headroomMcpSpec(headroomPath, selection.features)
      : undefined;
    for (const agent of context.selectedAgents.filter((item) =>
      mcpAgents.includes(item),
    )) {
      if (!expected) {
        checks.push({
          id: `headroom-mcp-${agent}`,
          status: "warn",
          message: `Cannot verify Headroom MCP for ${agent} without a resolved binary path`,
        });
        continue;
      }
      const existing = await readMcpServer(agent, context, "headroom");
      if (!existing) {
        checks.push({
          id: `headroom-mcp-${agent}`,
          status: "fail",
          message: `Headroom MCP is not configured for ${agent}`,
          remediation: "Rerun dont-waste init after Headroom is on PATH.",
        });
      } else if (
        existing.command === expected.command &&
        existing.args.join(" ") === expected.args.join(" ")
      ) {
        const expectedEnv = expected.env ?? {};
        const actualEnv = existing.env ?? {};
        const envOk = Object.entries(expectedEnv).every(
          ([key, value]) => actualEnv[key] === value,
        );
        checks.push({
          id: `headroom-mcp-${agent}`,
          status: envOk ? "pass" : "warn",
          message: envOk
            ? `Headroom MCP is configured for ${agent}`
            : `Headroom MCP for ${agent} is present but feature env differs (marker-owned Codex entries can be refreshed on init)`,
        });
      } else {
        checks.push({
          id: `headroom-mcp-${agent}`,
          status: "warn",
          message: `Headroom MCP for ${agent} exists but differs from the expected stdio command; left untouched`,
        });
      }
    }
    if (selection.features.ccrTtl) {
      checks.push({
        id: "headroom-ccr-ttl",
        status: "pass",
        message: `CCR TTL feature requests HEADROOM_CCR_TTL_SECONDS=${HEADROOM_CCR_TTL_SECONDS_VALUE} on marker-owned MCP env`,
      });
    }
    return checks;
  }

  async collectMetrics(context: AdapterContext): Promise<MetricImportResult> {
    const attempts: Array<{ source: string; args: string[] }> = [
      { source: "headroom perf", args: ["perf", "--format", "json"] },
      {
        source: "headroom output-savings",
        args: ["output-savings", "--format", "json"],
      },
      { source: "headroom stats", args: ["stats", "--format", "json"] },
    ];
    const errors: string[] = [];
    for (const attempt of attempts) {
      try {
        const result = await trackInFlight(
          execa("headroom", attempt.args, {
            reject: false,
            timeout: 15_000,
            forceKillAfterDelay: 5_000,
            ...(context.abortSignal
              ? { cancelSignal: context.abortSignal }
              : {}),
          }),
        );
        if (result.exitCode === 0 && result.stdout.trim()) {
          return {
            source: attempt.source,
            events: importHeadroomJson(result.stdout),
          };
        }
        errors.push(
          `${attempt.source}: ${result.stderr || result.stdout || `exit ${result.exitCode}`}`,
        );
      } catch (error) {
        errors.push(
          `${attempt.source}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return {
      source: "headroom metrics",
      events: [],
      error: `No Headroom metrics command succeeded (${errors.join(" | ")}). Upstream may not expose perf JSON in this version.`,
    };
  }

  async uninstallPaths(context: AdapterContext): Promise<string[]> {
    return [
      ...new Set(
        context.selectedAgents
          .map((agent) => mcpConfigPath(agent, context))
          .filter((file): file is string => Boolean(file)),
      ),
    ];
  }

  async uninstall(context: AdapterContext): Promise<InstallResult> {
    const detected = await this.detect(context);
    const unwrap = detected.detected
      ? context.selectedAgents.flatMap((agent) =>
          wrapName[agent]
            ? [
                {
                  command: "headroom",
                  args: ["unwrap", wrapName[agent] as string],
                  label: `Unwrap ${agent}`,
                  optional: true,
                },
              ]
            : [],
        )
      : [];
    const base = unwrap.length
      ? await this.install(
          this.basePlan({ mode: "off", features: {} }, context, unwrap),
          context,
        )
      : { succeeded: true, executed: [], skipped: [], errors: [] as string[] };
    // Unwrap failures must not block marker-owned MCP cleanup.
    const errors: string[] = [];
    if (!context.dryRun) {
      for (const agent of context.selectedAgents.filter((item) =>
        mcpAgents.includes(item),
      )) {
        const removed = await unregisterHeadroomMcp(agent, context);
        if (removed.status === "failed")
          errors.push(`MCP ${agent}: ${removed.detail}`);
      }
    }
    return {
      succeeded: errors.length === 0,
      executed: base.executed,
      skipped: base.skipped,
      errors: [
        ...errors,
        ...base.errors.map((item) => `unwrap (non-blocking): ${item}`),
      ],
    };
  }
}
