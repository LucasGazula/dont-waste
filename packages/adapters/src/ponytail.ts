import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentId, Mode } from "@dont-waste/catalog";
import { getAgentPaths, ponytailConfigPath } from "./agents.js";
import { BaseAdapter } from "./base.js";
import { findExecutable } from "./runtime.js";
import type {
  AdapterContext,
  Command,
  DetectionResult,
  HealthCheck,
  InstallResult,
  MetricImportResult,
  OperationPlan,
  ToolSelection,
} from "./types.js";

const repository = "DietrichGebert/ponytail";
const OWNED_MARKER = "dont-waste-owned";

/** Ponytail only accepts lite/full/ultra; map unsupported catalog modes to full. */
export function resolvePonytailMode(mode: Mode): "lite" | "full" | "ultra" {
  if (mode === "lite" || mode === "ultra") return mode;
  return "full";
}

export function ponytailActivePath(
  context: Pick<AdapterContext, "home">,
): string {
  return path.join(context.home, ".config", "ponytail", ".ponytail-active");
}

function commandsFor(agent: AgentId): Command[] {
  if (agent === "codex")
    return [
      {
        command: "codex",
        args: ["plugin", "marketplace", "add", repository],
        label: "Add Ponytail marketplace to Codex",
        optional: true,
        stopOnOptionalFailure: true,
      },
      {
        command: "codex",
        args: ["plugin", "add", "ponytail@ponytail"],
        label: "Install Ponytail plugin in Codex",
      },
      {
        command: "codex",
        args: [],
        label:
          "Open Codex /hooks to trust Ponytail hooks, then start a new thread",
        interactive: true,
      },
    ];
  if (agent === "claude-code")
    return [
      {
        command: "claude",
        args: ["plugin", "marketplace", "add", repository],
        label: "Add Ponytail marketplace to Claude Code",
        optional: true,
        stopOnOptionalFailure: true,
      },
      {
        command: "claude",
        args: ["plugin", "install", "ponytail@ponytail"],
        label: "Install Ponytail in Claude Code",
      },
    ];
  if (agent === "copilot-cli")
    return [
      {
        command: "copilot",
        args: ["plugin", "marketplace", "add", repository],
        label: "Add Ponytail marketplace to Copilot CLI",
        optional: true,
        stopOnOptionalFailure: true,
      },
      {
        command: "copilot",
        args: ["plugin", "install", "ponytail@ponytail"],
        label: "Install Ponytail in Copilot CLI",
      },
    ];

  if (agent === "antigravity-cli")
    return [
      {
        command: "agy",
        args: [
          "plugin",
          "install",
          "https://github.com/DietrichGebert/ponytail",
        ],
        label: "Install Ponytail Antigravity extension",
      },
    ];
  if (agent === "pi")
    return [
      {
        command: "pi",
        args: ["install", "git:github.com/DietrichGebert/ponytail"],
        label: "Install Ponytail in Pi",
      },
    ];
  return [];
}

function isMarketplaceRegistration(command: Command): boolean {
  return (
    command.args[0] === "plugin" &&
    command.args[1] === "marketplace" &&
    command.args[2] === "add"
  );
}

function uninstallCommandsFor(agent: AgentId): Command[] {
  if (agent === "codex")
    return [
      {
        command: "codex",
        args: ["plugin", "remove", "ponytail"],
        label: "Remove Ponytail from Codex",
      },
    ];
  if (agent === "claude-code")
    return [
      {
        command: "claude",
        args: ["plugin", "remove", "ponytail"],
        label: "Remove Ponytail from Claude Code",
      },
    ];
  if (agent === "pi")
    return [
      {
        command: "pi",
        args: ["uninstall", "ponytail"],
        label: "Remove Ponytail from Pi",
      },
    ];

  if (agent === "copilot-cli")
    return [
      {
        command: "copilot",
        args: ["plugin", "remove", "ponytail"],
        label: "Remove Ponytail from Copilot CLI",
      },
    ];
  if (agent === "antigravity-cli")
    return [
      {
        command: "agy",
        args: ["plugin", "uninstall", "ponytail"],
        label: "Remove Ponytail Antigravity extension",
      },
    ];
  return [];
}

async function updateJson(
  file: string,
  transform: (value: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  let current: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      current = parsed as Record<string, unknown>;
    else throw new Error("configuration root is not an object");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    `${JSON.stringify(transform(current), null, 2)}\n`,
    "utf8",
  );
}

export class PonytailAdapter extends BaseAdapter {
  readonly id = "ponytail" as const;

  async detect(context: AdapterContext): Promise<DetectionResult> {
    const node = await findExecutable(
      "node",
      context.platform,
      context.abortSignal,
    );
    const configFile = ponytailConfigPath(context);
    const marker = ponytailActivePath(context);
    let configPresent = false;
    let markerPresent = false;
    try {
      await access(configFile);
      configPresent = true;
    } catch {
      /* absent */
    }
    try {
      await access(marker);
      markerPresent = true;
    } catch {
      /* absent */
    }
    if (!configPresent && !markerPresent) {
      return {
        id: this.id,
        detected: false,
        warnings: [
          node
            ? "Ponytail is not installed (no config/marker); Node.js is available for hooks"
            : "Ponytail is not installed; Node.js on PATH is required for always-on hooks",
        ],
      };
    }
    return {
      id: this.id,
      detected: true,
      path: configPresent ? configFile : marker,
      warnings: node
        ? []
        : ["Ponytail config found but Node.js is absent from PATH"],
    };
  }

  async planInstall(
    selection: ToolSelection,
    context: AdapterContext,
  ): Promise<OperationPlan> {
    const detected = await this.detect(context);
    const commands = context.selectedAgents.flatMap((agent) => {
      const planned = commandsFor(agent);
      return detected.detected
        ? planned.filter((command) => !isMarketplaceRegistration(command))
        : planned;
    });
    const affectedPaths = context.selectedAgents.length
      ? [
          ponytailConfigPath(context),
          ponytailActivePath(context),
          ...context.selectedAgents.flatMap((agent) =>
            getAgentPaths(agent, context),
          ),
        ]
      : [];
    const mode = resolvePonytailMode(selection.mode);
    return this.basePlan(
      selection,
      context,
      commands,
      [
        context.selectedAgents.length === 0
          ? "install-only: Don’t Waste will not write Ponytail or agent configuration files."
          : `Ponytail default mode: ${mode}. It keeps validation, error handling, security, and accessibility intact.`,
        "Codex hook approval is intentionally manual: Don’t Waste installs the plugin, but you must trust its hooks in /hooks and start a new thread.",
        context.selectedAgents.includes("opencode")
          ? "OpenCode receives @dietrichgebert/ponytail in opencode.json during install."
          : "",
        context.selectedAgents.some((agent) =>
          ["codex", "claude-code", "copilot-cli"].includes(agent),
        )
          ? detected.detected
            ? "Existing Ponytail install detected; marketplace registration is skipped and existing sources are preserved."
            : "Ponytail marketplace registration preserves existing sources; a rejected registration stops dependent plugin installation for review."
          : "",
      ].filter(Boolean),
      affectedPaths,
    );
  }

  async install(plan: OperationPlan, context: AdapterContext) {
    const base = await super.install(plan, context);
    if (!base.succeeded || context.dryRun) return base;
    if (!context.selectedAgents.length) return base;
    const configFile = ponytailConfigPath(context);
    const defaultMode = resolvePonytailMode(plan.selection.mode);
    await updateJson(configFile, (value) => ({
      ...value,
      defaultMode,
      [OWNED_MARKER]: true,
    }));
    await mkdir(path.dirname(ponytailActivePath(context)), { recursive: true });
    await writeFile(ponytailActivePath(context), `${defaultMode}\n`, "utf8");
    if (context.selectedAgents.includes("opencode")) {
      const config = getAgentPaths("opencode", context)[0];
      if (config)
        await updateJson(config, (value) => {
          const existing = Array.isArray(value.plugin)
            ? value.plugin.filter(
                (item): item is string => typeof item === "string",
              )
            : [];
          return {
            ...value,
            plugin: [...new Set([...existing, "@dietrichgebert/ponytail"])],
          };
        });
    }
    return base;
  }

  async verify(
    selection: ToolSelection,
    context: AdapterContext,
  ): Promise<HealthCheck[]> {
    const node = await findExecutable(
      "node",
      context.platform,
      context.abortSignal,
    );
    const expectedMode = resolvePonytailMode(selection.mode);
    const checks: HealthCheck[] = [
      node
        ? {
            id: "ponytail-node",
            status: "pass",
            message: "Node.js is on PATH for Ponytail hooks",
          }
        : {
            id: "ponytail-node",
            status: "warn",
            message:
              "Ponytail skills can load, but always-on hooks need Node.js on non-interactive PATH.",
          },
    ];
    try {
      const config = JSON.parse(
        await readFile(ponytailConfigPath(context), "utf8"),
      ) as { defaultMode?: unknown };
      checks.push(
        config.defaultMode === expectedMode
          ? {
              id: "ponytail-mode",
              status: "pass",
              message: `Ponytail defaultMode is ${expectedMode}`,
            }
          : {
              id: "ponytail-mode",
              status: "fail",
              message: `Ponytail defaultMode is ${String(config.defaultMode)}, expected ${expectedMode}`,
            },
      );
    } catch {
      checks.push({
        id: "ponytail-mode",
        status: "warn",
        message: "Ponytail config.json is not readable yet",
      });
    }
    if (context.selectedAgents.includes("opencode")) {
      const file = getAgentPaths("opencode", context)[0];
      try {
        const config = file
          ? (JSON.parse(await readFile(file, "utf8")) as { plugin?: unknown })
          : {};
        checks.push(
          Array.isArray(config.plugin) &&
            config.plugin.includes("@dietrichgebert/ponytail")
            ? {
                id: "ponytail-opencode",
                status: "pass",
                message: "OpenCode Ponytail plugin is configured",
              }
            : {
                id: "ponytail-opencode",
                status: "fail",
                message: "OpenCode Ponytail plugin is missing",
              },
        );
      } catch {
        checks.push({
          id: "ponytail-opencode",
          status: "warn",
          message: "OpenCode configuration is not readable yet",
        });
      }
    }
    return checks;
  }

  async collectMetrics(): Promise<MetricImportResult> {
    return {
      source: "ponytail",
      events: [],
      error:
        "Ponytail has no operational token telemetry; upstream benchmarks remain reference-only.",
    };
  }

  async uninstallPaths(context: AdapterContext): Promise<string[]> {
    const paths = [ponytailConfigPath(context), ponytailActivePath(context)];
    if (
      context.selectedAgents.includes("opencode") ||
      context.selectedAgents.length === 0
    ) {
      paths.push(...getAgentPaths("opencode", context));
    }
    return [...new Set(paths)];
  }

  async uninstall(context: AdapterContext): Promise<InstallResult> {
    const commands = context.selectedAgents.flatMap(uninstallCommandsFor);
    const plan = this.basePlan(
      { mode: "off", features: {} },
      context,
      commands,
      ["Marketplace/extension removals that lack a stable CLI remain manual."],
    );
    const base = await super.install(plan, context);
    const errors = [...base.errors];
    if (!context.dryRun) {
      if (
        context.selectedAgents.includes("opencode") ||
        context.selectedAgents.length === 0
      ) {
        const config = getAgentPaths("opencode", context)[0];
        if (config) {
          try {
            await updateJson(config, (value) => ({
              ...value,
              plugin: Array.isArray(value.plugin)
                ? value.plugin.filter(
                    (item) => item !== "@dietrichgebert/ponytail",
                  )
                : [],
            }));
          } catch (error) {
            errors.push(
              `OpenCode cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
      const configFile = ponytailConfigPath(context);
      try {
        const raw = await readFile(configFile, "utf8");
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (parsed[OWNED_MARKER] === true) {
          // File was created/owned by Don’t Waste — safe to remove entirely.
          await rm(configFile, { force: true });
        } else {
          // Preserve user-managed keys; only drop fields we wrote.
          const {
            defaultMode: _drop,
            [OWNED_MARKER]: _owned,
            ...rest
          } = parsed;
          if (Object.keys(rest).length === 0)
            await rm(configFile, { force: true });
          else
            await writeFile(
              configFile,
              `${JSON.stringify(rest, null, 2)}\n`,
              "utf8",
            );
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          errors.push(
            `Ponytail config cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      try {
        await rm(ponytailActivePath(context), { force: true });
      } catch (error) {
        errors.push(
          `Marker cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const manual = context.selectedAgents.filter(
      (agent) => !uninstallCommandsFor(agent).length && agent !== "opencode",
    );
    return {
      succeeded: errors.length === 0 && base.succeeded,
      executed: base.executed,
      skipped: base.skipped,
      errors: [
        ...errors,
        ...manual.map(
          (agent) =>
            `${agent}: remove Ponytail via that agent’s plugin/extension manager if still present`,
        ),
      ],
    };
  }
}
