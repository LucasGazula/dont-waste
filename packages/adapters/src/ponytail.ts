import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentId, Mode } from "@dont-waste/catalog";
import { getAgentPaths, ponytailConfigPath } from "./agents.js";
import { BaseAdapter } from "./base.js";
import {
  findExecutable,
  getActiveCodexProcesses,
  getCodexRuntimeDiagnostic,
  isCodexMarketplaceAvailable,
  directoryExists,
} from "./runtime.js";
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
      },
      {
        command: "codex",
        args: ["plugin", "add", "ponytail@ponytail"],
        label: "Install Ponytail plugin in Codex",
        optional: true,
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
      },
      {
        command: "claude",
        args: ["plugin", "install", "ponytail@ponytail"],
        label: "Install Ponytail in Claude Code",
        optional: true,
      },
    ];
  if (agent === "copilot-cli")
    return [
      {
        command: "copilot",
        args: ["plugin", "marketplace", "add", repository],
        label: "Add Ponytail marketplace to Copilot CLI",
        optional: true,
      },
      {
        command: "copilot",
        args: ["plugin", "install", "ponytail@ponytail"],
        label: "Install Ponytail in Copilot CLI",
        optional: true,
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

function isMarketplaceDependentPlugin(command: Command): boolean {
  return (
    command.args[0] === "plugin" &&
    (command.args[1] === "add" || command.args[1] === "install")
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

/**
 * A Ponytail config is shared state, not proof that every selected host has
 * loaded its native plugin.  Only skip a host's install commands when that
 * host's own configuration says the plugin is enabled.
 */
async function ponytailInstalledForAgent(
  agent: AgentId,
  context: Pick<AdapterContext, "home" | "platform">,
): Promise<boolean> {
  try {
    if (agent === "claude-code") {
      const file = getAgentPaths(agent, context)[0];
      if (!file) return false;
      const config = JSON.parse(await readFile(file, "utf8")) as {
        enabledPlugins?: Record<string, unknown>;
      };
      return config.enabledPlugins?.["ponytail@ponytail"] === true;
    }
    if (agent === "codex") {
      const file = getAgentPaths(agent, context)[0];
      if (!file) return false;
      const config = await readFile(file, "utf8");
      const section = config.match(
        /\[plugins\."ponytail@ponytail"\]([\s\S]*?)(?=\n\[|$)/,
      );
      return Boolean(
        section && !/^\s*enabled\s*=\s*false\s*$/m.test(section[1] ?? ""),
      );
    }
    if (agent === "opencode") {
      const file = getAgentPaths(agent, context)[0];
      if (!file) return false;
      const config = JSON.parse(await readFile(file, "utf8")) as {
        plugin?: unknown;
      };
      return (
        Array.isArray(config.plugin) &&
        config.plugin.includes("@dietrichgebert/ponytail")
      );
    }
  } catch {
    // A missing or unreadable host config means we have no evidence of an
    // installation, so keep the host's installer command in the plan.
  }
  return false;
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
    const installedAgents = new Set(
      (
        await Promise.all(
          context.selectedAgents.map(async (agent) =>
            (await ponytailInstalledForAgent(agent, context))
              ? agent
              : undefined,
          ),
        )
      ).filter((agent): agent is AgentId => Boolean(agent)),
    );

    const activeProcesses = context.selectedAgents.includes("codex")
      ? await getActiveCodexProcesses(context)
      : [];
    const codexActive = activeProcesses.length > 0;

    const marketplaceAvailable = context.selectedAgents.includes("codex")
      ? await isCodexMarketplaceAvailable(context)
      : false;

    const codexHome =
      process.env.CODEX_HOME ?? path.join(context.home, ".codex");
    const staleMarketplaceDir = path.join(
      codexHome,
      ".tmp",
      "marketplaces",
      "ponytail",
    );
    const staleDirExists = context.selectedAgents.includes("codex")
      ? await directoryExists(staleMarketplaceDir)
      : false;

    const warnings: string[] = [];

    const commands = context.selectedAgents.flatMap((agent) => {
      const planned = commandsFor(agent);
      if (agent === "codex") {
        if (codexActive) {
          return [];
        }
        return planned.filter((cmd) => {
          if (isMarketplaceDependentPlugin(cmd)) {
            return !staleDirExists;
          }
          if (isMarketplaceRegistration(cmd)) {
            return !marketplaceAvailable;
          }
          return true;
        });
      }
      return installedAgents.has(agent)
        ? planned.filter(
            (command) =>
              !isMarketplaceRegistration(command) &&
              !isMarketplaceDependentPlugin(command),
          )
        : planned;
    });

    if (context.selectedAgents.includes("codex")) {
      if (codexActive) {
        const pids = activeProcesses.map((p) => p.pid).join(", ");
        warnings.push(
          `Active Codex processes detected targeting CODEX_HOME (PIDs: ${pids}). Codex Ponytail plugin installation is blocked/deferred.`,
        );
      } else {
        if (staleDirExists && !marketplaceAvailable) {
          warnings.push(
            "Stale hidden Ponytail marketplace detected under CODEX_HOME/.tmp/marketplaces/ponytail without registration. Plugin installation is deferred. Please resolve this conflict first.",
          );
        } else if (!marketplaceAvailable) {
          warnings.push(
            "Codex Ponytail plugin installation is planned to run after registering the ponytail marketplace.",
          );
        }
      }
    }

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
          ? installedAgents.size
            ? `Ponytail is already configured for ${[...installedAgents].join(", ")}; only those hosts skip marketplace-dependent commands.`
            : "Ponytail marketplace conflicts are preserved; failed host plugin commands remain visible in doctor and do not abort other hosts."
          : "",
        ...warnings,
      ].filter(Boolean),
      affectedPaths,
    );
  }

  async install(
    plan: OperationPlan,
    context: AdapterContext,
  ): Promise<InstallResult> {
    if (context.selectedAgents.includes("codex")) {
      const active = await getActiveCodexProcesses(context);
      if (active.length > 0) {
        return {
          succeeded: false,
          executed: [],
          skipped: plan.commands,
          errors: [
            `Active Codex processes detected targeting CODEX_HOME (PIDs: ${active.map((p) => p.pid).join(", ")}). Deferring Ponytail Codex installation to prevent overwriting/conflicts.`,
          ],
        };
      }

      const codexHome =
        process.env.CODEX_HOME ?? path.join(context.home, ".codex");
      const staleMarketplaceDir = path.join(
        codexHome,
        ".tmp",
        "marketplaces",
        "ponytail",
      );
      const staleDirExists = await directoryExists(staleMarketplaceDir);
      const marketplaceAvailableBefore =
        await isCodexMarketplaceAvailable(context);

      if (staleDirExists && !marketplaceAvailableBefore) {
        return {
          succeeded: false,
          executed: [],
          skipped: plan.commands,
          errors: [
            "Stale hidden Ponytail marketplace detected without registration. Codex Ponytail plugin installation is deferred/blocked. Please resolve this conflict first.",
          ],
        };
      }
    }

    const executed: Command[] = [];
    const skipped: Command[] = [];
    const errors: string[] = [];

    let codexPluginAdded = false;

    for (const [index, command] of plan.commands.entries()) {
      if (command.command === "codex" && command.args[1] === "add") {
        const isMarketplaceVisible = await isCodexMarketplaceAvailable(context);
        if (!isMarketplaceVisible) {
          skipped.push(command);
          errors.push(
            "Marketplace 'DietrichGebert/ponytail' is not registered or visible in Codex; skipping plugin installation.",
          );
          skipped.push(...plan.commands.slice(index + 1));
          break;
        }
      }

      const result = await runCommand(
        command,
        context.dryRun,
        commandHooksFromAdapterContext(context),
      );

      if (result.ran) {
        executed.push(command);
        if (command.command === "codex" && command.args[1] === "add") {
          codexPluginAdded = true;
        }
      } else {
        skipped.push(command);
      }

      if (result.error) {
        if (!command.optional) {
          errors.push(result.error);
          skipped.push(...plan.commands.slice(index + 1));
          break;
        } else {
          errors.push(`Optional command failed: ${result.error}`);
        }
      }
    }

    const codexWasTargeted = context.selectedAgents.includes("codex");
    const codexFailed = codexWasTargeted && !codexPluginAdded;
    const succeeded =
      errors.filter((e) => !e.startsWith("Optional command failed")).length ===
        0 && !codexFailed;

    if (!succeeded || context.dryRun) {
      return {
        succeeded: false,
        executed,
        skipped,
        errors,
      };
    }

    if (!context.selectedAgents.length) {
      return { succeeded: true, executed, skipped, errors };
    }

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

    return { succeeded: true, executed, skipped, errors };
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

    if (context.selectedAgents.includes("codex")) {
      checks.push(await getCodexRuntimeDiagnostic(context));

      const codexHome =
        process.env.CODEX_HOME ?? path.join(context.home, ".codex");
      const staleMarketplaceDir = path.join(
        codexHome,
        ".tmp",
        "marketplaces",
        "ponytail",
      );
      const staleDirExists = await directoryExists(staleMarketplaceDir);
      const marketplaceAvailable = await isCodexMarketplaceAvailable(context);

      const mcpExplanatoryNote =
        ". Note: Ponytail is a Codex plugin and does not register as an MCP server; checking '/mcp' inside Codex will NOT show Ponytail.";

      // 1. Marketplace ownership / visibility check
      if (staleDirExists && !marketplaceAvailable) {
        checks.push({
          id: "ponytail-codex-marketplace-conflict",
          status: "fail",
          message:
            "Stale hidden Ponytail marketplace detected under CODEX_HOME/.tmp/marketplaces/ponytail without registration" +
            mcpExplanatoryNote,
          remediation: `A conflicting user-owned ponytail marketplace directory exists but is not registered.
To migrate:
  1. Ensure all Codex processes are closed.
  2. Run:
     mv "${staleMarketplaceDir}" "${staleMarketplaceDir}.dont-waste-backup-\$(date +%Y%m%d-%H%M%S)"
  3. Re-run 'dont-waste init' to register and install Ponytail.
To reverse:
  1. Close all Codex processes.
  2. Run:
     rm -rf "${staleMarketplaceDir}"
     mv "${staleMarketplaceDir}.dont-waste-backup-<timestamp>" "${staleMarketplaceDir}"`,
          blocksActivation: true,
        });
      } else {
        checks.push({
          id: "ponytail-codex-marketplace",
          status: marketplaceAvailable ? "pass" : "fail",
          message:
            (marketplaceAvailable
              ? "Codex Ponytail marketplace is registered and visible"
              : "Codex Ponytail marketplace is not registered") +
            mcpExplanatoryNote,
          remediation:
            "Run 'dont-waste init' to register the Ponytail marketplace in Codex.",
        });
      }

      // 2. Plugin installation check
      const pluginInstalled = await ponytailInstalledForAgent("codex", context);
      checks.push({
        id: "ponytail-codex-plugin",
        status: pluginInstalled ? "pass" : "fail",
        message:
          (pluginInstalled
            ? "Codex Ponytail plugin is installed and enabled"
            : "Codex Ponytail plugin is not installed/enabled") +
          mcpExplanatoryNote,
        remediation:
          "Ensure the Ponytail marketplace is registered, then run 'dont-waste init' to install the plugin.",
      });

      // 3. Hook approval check
      checks.push({
        id: "ponytail-codex-hooks-trust",
        status: "warn",
        message:
          "Codex Ponytail hook approval requires manual trust in the Codex /hooks screen" +
          mcpExplanatoryNote,
        remediation: "Open Codex /hooks and trust the Ponytail plugin hooks.",
        blocksActivation: false,
      });

      // 4. New-thread loading check
      checks.push({
        id: "ponytail-codex-new-thread",
        status: "warn",
        message:
          "Ponytail plugin loading requires starting a fresh conversation thread in Codex" +
          mcpExplanatoryNote,
        remediation: "Start a new thread in Codex to load the Ponytail plugin.",
        blocksActivation: false,
      });
    }

    for (const agent of context.selectedAgents.filter((item) =>
      ["claude-code", "opencode"].includes(item),
    )) {
      const label = agent === "claude-code" ? "Claude Code" : "OpenCode";
      checks.push(
        (await ponytailInstalledForAgent(agent, context))
          ? {
              id: `ponytail-${agent}`,
              status: "pass",
              message: `${label} Ponytail plugin is enabled`,
            }
          : {
              id: `ponytail-${agent}`,
              status: "fail",
              message: `${label} Ponytail plugin is not enabled`,
              remediation:
                "Install or enable Ponytail in this host, then start a new session.",
            },
      );
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
    const activeProcesses = context.selectedAgents.includes("codex")
      ? await getActiveCodexProcesses(context)
      : [];
    const codexActive = activeProcesses.length > 0;
    const commands = context.selectedAgents.flatMap((agent) => {
      if (agent === "codex" && codexActive) {
        return [];
      }
      return uninstallCommandsFor(agent);
    });
    const planWarnings = [
      "Marketplace/extension removals that lack a stable CLI remain manual.",
      codexActive
        ? `Active Codex processes detected targeting CODEX_HOME (PIDs: ${activeProcesses.map((p) => p.pid).join(", ")}). Codex Ponytail removal is blocked/deferred.`
        : "",
    ].filter(Boolean);
    const plan = this.basePlan(
      { mode: "off", features: {} },
      context,
      commands,
      planWarnings,
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
