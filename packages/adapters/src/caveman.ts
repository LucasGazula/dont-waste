import {
  access,
  lstat,
  mkdir,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { AgentId, Mode } from "@dont-waste/catalog";
import { importCavemanStats } from "@dont-waste/telemetry";
import { getAgentPaths } from "./agents.js";
import { BaseAdapter } from "./base.js";
import { findExecutable, getCodexRuntimeDiagnostic } from "./runtime.js";
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
  "copilot-cli": "copilot",
  "antigravity-cli": "antigravity",
  opencode: "opencode",
};

export function resolveCavemanMode(mode: Mode): string {
  if (mode === "off") return "full";
  return mode;
}

const OWNED_MARKER = "dont-waste-owned";

export function cavemanConfigPath(
  context: Pick<AdapterContext, "platform" | "home">,
): string {
  return context.platform === "win32"
    ? path.join(
        process.env.APPDATA ?? path.join(context.home, "AppData", "Roaming"),
        "caveman",
        "config.json",
      )
    : path.join(context.home, ".config", "caveman", "config.json");
}

export function cavemanCodexSkillPath(
  context: Pick<AdapterContext, "home">,
): string {
  const codexHome = process.env.CODEX_HOME ?? path.join(context.home, ".codex");
  return path.join(codexHome, "skills", "caveman", "SKILL.md");
}

export function cavemanAntigravitySkillPath(
  context: Pick<AdapterContext, "home">,
): string {
  return path.join(
    context.home,
    ".gemini",
    "antigravity-cli",
    "skills",
    "caveman",
    "SKILL.md",
  );
}

function findAgentsDir(dir: string): string | undefined {
  const candidate = path.join(dir, ".agents");
  if (existsSync(candidate)) return candidate;
  const parent = path.dirname(dir);
  return parent === dir ? undefined : findAgentsDir(parent);
}

function cavemanGlobalSkillDir(context: Pick<AdapterContext, "home">): string {
  if (!process.env.VITEST) {
    const localAgents = findAgentsDir(process.cwd());
    if (localAgents) {
      return path.join(localAgents, "skills", "caveman");
    }
  }
  return path.join(context.home, ".agents", "skills", "caveman");
}

function cavemanSkillTargetDir(
  agent: AgentId,
  context: Pick<AdapterContext, "home">,
): string | undefined {
  const skillPath =
    agent === "codex"
      ? cavemanCodexSkillPath(context)
      : agent === "antigravity-cli"
        ? cavemanAntigravitySkillPath(context)
        : undefined;
  return skillPath ? path.dirname(skillPath) : undefined;
}

type CavemanSkillLinkState = "missing" | "canonical" | "external" | "conflict";

async function cavemanSkillLinkState(
  agent: AgentId,
  context: Pick<AdapterContext, "home">,
): Promise<CavemanSkillLinkState> {
  const targetDir = cavemanSkillTargetDir(agent, context);
  if (!targetDir) return "missing";
  try {
    const target = await lstat(targetDir);
    if (!target.isSymbolicLink()) return "conflict";
    const link = await readlink(targetDir);
    const resolvedLink = path.resolve(path.dirname(targetDir), link);
    if (resolvedLink === path.resolve(cavemanGlobalSkillDir(context)))
      return "canonical";
    try {
      await access(path.join(resolvedLink, "SKILL.md"));
      return "external";
    } catch {
      return "conflict";
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    return "conflict";
  }
}

async function hasCanonicalCavemanSkillLink(
  agent: AgentId,
  context: Pick<AdapterContext, "home">,
): Promise<boolean> {
  const state = await cavemanSkillLinkState(agent, context);
  if (state !== "canonical" && state !== "external") return false;
  try {
    await access(path.join(cavemanGlobalSkillDir(context), "SKILL.md"));
    return true;
  } catch {
    return false;
  }
}

function cavemanSkillConflictMessage(
  agent: AgentId,
  context: Pick<AdapterContext, "home">,
): string {
  return `${agent} existing skill target is not a Don’t Waste link: ${cavemanSkillTargetDir(agent, context)}`;
}

async function cavemanSkillConflicts(
  context: Pick<AdapterContext, "home" | "selectedAgents">,
): Promise<string[]> {
  return (
    await Promise.all(
      context.selectedAgents
        .filter(
          (agent): agent is "codex" | "antigravity-cli" =>
            agent === "codex" || agent === "antigravity-cli",
        )
        .map(async (agent) =>
          (await cavemanSkillLinkState(agent, context)) === "conflict"
            ? cavemanSkillConflictMessage(agent, context)
            : undefined,
        ),
    )
  ).filter((message): message is string => Boolean(message));
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

function cavemanMarkerPath(
  agent: AgentId,
  context: Pick<AdapterContext, "home">,
): string | undefined {
  if (agent === "claude-code")
    return path.join(context.home, ".claude", ".caveman-active");
  if (agent === "opencode")
    return path.join(context.home, ".config", "opencode", ".caveman-active");
  return undefined;
}

function claudeProjectSettingsPath(): string {
  let current = process.cwd();
  for (;;) {
    const candidate = path.join(current, ".claude", "settings.json");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current)
      return path.join(process.cwd(), ".claude", "settings.json");
    current = parent;
  }
}

async function cavemanAgentInstalled(
  agent: AgentId,
  context: Pick<AdapterContext, "home">,
): Promise<boolean> {
  if (agent === "codex" || agent === "antigravity-cli")
    return hasCanonicalCavemanSkillLink(agent, context);
  const marker = cavemanMarkerPath(agent, context);
  if (!marker) return false;
  try {
    await access(marker);
    return true;
  } catch {
    return false;
  }
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

async function claudeCavemanEnabled(
  context: Pick<AdapterContext, "home" | "platform">,
): Promise<boolean> {
  const files = [
    getAgentPaths("claude-code", context)[0],
    claudeProjectSettingsPath(),
  ].filter((file): file is string => Boolean(file));
  for (const file of files) {
    try {
      const config = JSON.parse(await readFile(file, "utf8")) as {
        enabledPlugins?: Record<string, unknown>;
      };
      if (config.enabledPlugins?.["caveman@caveman"] === true) return true;
    } catch {
      // Continue to the other supported scope.
    }
  }
  return false;
}

export class CavemanAdapter extends BaseAdapter {
  readonly id = "caveman" as const;

  async detect(context: AdapterContext): Promise<DetectionResult> {
    const node = await findExecutable(
      "node",
      process.platform,
      context.abortSignal,
    );
    const markers: string[] = [];
    for (const file of cavemanDetectPaths(context.home)) {
      try {
        await access(file);
        markers.push(file);
      } catch {
        /* absent */
      }
    }
    const configFile = cavemanConfigPath(context);
    let configPresent = false;
    try {
      await access(configFile);
      configPresent = true;
    } catch {
      /* absent */
    }

    if (!markers.length && !configPresent) {
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
      path: markers[0] ?? configFile,
      warnings: node
        ? []
        : ["Caveman markers/config found but Node.js is absent from PATH"],
    };
  }

  async planInstall(
    selection: ToolSelection,
    context: AdapterContext,
  ): Promise<OperationPlan> {
    const activeProcesses = context.selectedAgents.includes("codex")
      ? await getActiveCodexProcesses(context)
      : [];
    const codexActive = activeProcesses.length > 0;

    const filteredAgents = codexActive
      ? context.selectedAgents.filter((agent) => agent !== "codex")
      : context.selectedAgents;

    const planningContext = {
      ...context,
      selectedAgents: filteredAgents,
    };

    const unsupported = planningContext.selectedAgents.filter(
      (agent) => !cavemanOnlyId[agent],
    );
    const mode = resolveCavemanMode(selection.mode);
    const affectedPaths = cavemanActivePaths(planningContext);
    if (planningContext.selectedAgents.length) {
      affectedPaths.push(cavemanConfigPath(planningContext));
      const skillTargetDirs = planningContext.selectedAgents
        .map((agent) => cavemanSkillTargetDir(agent, planningContext))
        .filter((targetDir): targetDir is string => Boolean(targetDir));
      if (skillTargetDirs.length) {
        const globalSkillDir = cavemanGlobalSkillDir(planningContext);
        affectedPaths.push(path.dirname(globalSkillDir), globalSkillDir);
        for (const targetDir of skillTargetDirs) {
          affectedPaths.push(path.dirname(targetDir), targetDir);
        }
      }
      if (planningContext.selectedAgents.includes("claude-code")) {
        affectedPaths.push(claudeProjectSettingsPath());
      }
    }
    const installTargets = (
      await Promise.all(
        planningContext.selectedAgents
          .filter((agent) => cavemanOnlyId[agent])
          .map(async (agent) =>
            (await cavemanAgentInstalled(agent, planningContext))
              ? undefined
              : agent,
          ),
      )
    ).filter((agent): agent is AgentId => Boolean(agent));
    const commands = [
      ...(installTargets.length
        ? [
            {
              command: "npx",
              args: installArgs({
                ...planningContext,
                selectedAgents: installTargets,
              }),
              label: "Run the official Caveman installer for selected agents",
              env: { CI: "true" },
              timeoutMs: 180_000,
              forceKillAfterDelay: 5_000,
            },
          ]
        : []),
      ...(planningContext.selectedAgents.includes("claude-code")
        ? [
            {
              command: "claude",
              args: [
                "plugin",
                "enable",
                "caveman@caveman",
                "--scope",
                "project",
              ],
              label: "Enable Caveman plugin in Claude Code",
              optional: true,
            },
          ]
        : []),
    ];
    const supportedSelected = planningContext.selectedAgents.filter(
      (agent) => cavemanOnlyId[agent],
    );
    const skillConflicts = await cavemanSkillConflicts(planningContext);
    return this.basePlan(
      selection,
      planningContext,
      commands,
      [
        codexActive
          ? `Active Codex processes detected targeting CODEX_HOME (PIDs: ${activeProcesses.map((p) => p.pid).join(", ")}). Caveman Codex setup is blocked/deferred.`
          : undefined,
        planningContext.selectedAgents.length === 0
          ? "install-only: Caveman binary/skills install may run, but Don’t Waste will not write agent marker files."
          : installTargets.length
            ? `Caveman mode: ${mode}. Official installer targets: ${installTargets.join(", ")}.`
            : supportedSelected.length
              ? "Existing Caveman install detected for the selected agents; Don’t Waste will only refresh mode/config files."
              : "No selected agent has a Caveman --only target; no upstream installer command was planned.",
        "Caveman session savings are estimates and never enter the measured total.",
        selection.features.statusline
          ? "Statusline savings stay enabled (default Caveman behavior)."
          : "To silence the Claude Code savings badge later, set CAVEMAN_STATUSLINE_SAVINGS=0.",
        selection.features.cavecrew
          ? "Cavecrew subagents enabled (investigator, builder, reviewer)."
          : "Cavecrew subagents disabled.",
        selection.features.compress
          ? "Caveman-compress enabled (compresses CLAUDE.md/notes)."
          : "Caveman-compress disabled.",
        ...unsupported.map(
          (agent) => `${agent} has no Caveman --only target yet; skipped.`,
        ),
        ...skillConflicts.map(
          (message) =>
            `${message}. Don’t Waste will preserve it and stop before installation.`,
        ),
      ].filter((m): m is string => Boolean(m)),
      [...new Set(affectedPaths)],
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
            `Active Codex processes detected targeting CODEX_HOME (PIDs: ${active.map((p) => p.pid).join(", ")}). Deferring Caveman Codex installation to prevent overwriting/conflicts.`,
          ],
        };
      }
    }

    if (!context.dryRun) {
      const conflicts = await cavemanSkillConflicts(context);
      if (conflicts.length)
        return {
          succeeded: false,
          executed: [],
          skipped: [],
          errors: conflicts,
        };
    }

    const base = await super.install(plan, context);
    if (!base.succeeded || context.dryRun) return base;
    if (!context.selectedAgents.length) return base;

    const linkErrors: string[] = [];
    for (const agent of context.selectedAgents) {
      if (agent === "codex" || agent === "antigravity-cli") {
        const error = await ensureSkillLinked(agent, context);
        if (error) linkErrors.push(error);
      }
    }
    if (linkErrors.length)
      return {
        ...base,
        succeeded: false,
        errors: [...base.errors, ...linkErrors],
      };

    const markers = cavemanActivePaths(context);
    const mode = resolveCavemanMode(plan.selection.mode);
    for (const file of markers) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, `${mode}\n`, "utf8");
    }

    const configFile = cavemanConfigPath(context);
    const cavecrew = plan.selection.features.cavecrew ?? false;
    const compress = plan.selection.features.compress ?? false;
    await updateJson(configFile, (value) => ({
      ...value,
      defaultMode: mode,
      cavecrew,
      compress,
      [OWNED_MARKER]: true,
    }));

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
    if (context.selectedAgents.includes("codex")) {
      checks.push(await getCodexRuntimeDiagnostic(context));
      checks.push(await cavemanSkillHealthCheck("codex", context));
    }
    if (context.selectedAgents.includes("antigravity-cli")) {
      checks.push(await cavemanSkillHealthCheck("antigravity-cli", context));
    }
    if (context.selectedAgents.includes("claude-code")) {
      checks.push(
        (await claudeCavemanEnabled(context))
          ? {
              id: "caveman-claude-plugin",
              status: "pass",
              message: "Caveman plugin is enabled in Claude Code",
            }
          : {
              id: "caveman-claude-plugin",
              status: "fail",
              message: "Caveman plugin is not enabled in Claude Code",
              remediation:
                "Run claude plugin enable caveman@caveman --scope project, then start a new Claude Code session.",
            },
      );
    }
    if (
      !modeFiles.length &&
      !context.selectedAgents.includes("codex") &&
      !context.selectedAgents.includes("antigravity-cli")
    ) {
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

    const configFile = cavemanConfigPath(context);
    try {
      const config = JSON.parse(await readFile(configFile, "utf8")) as {
        defaultMode?: unknown;
        cavecrew?: unknown;
        compress?: unknown;
      };
      checks.push(
        config.defaultMode === expected
          ? {
              id: "caveman-default-mode",
              status: "pass",
              message: `Caveman defaultMode is ${expected}`,
            }
          : {
              id: "caveman-default-mode",
              status: "fail",
              message: `Caveman defaultMode is ${String(config.defaultMode)}, expected ${expected}`,
            },
      );

      const expectedCavecrew = selection.features.cavecrew ?? false;
      checks.push(
        config.cavecrew === expectedCavecrew
          ? {
              id: "caveman-cavecrew",
              status: "pass",
              message: `Caveman cavecrew is ${expectedCavecrew}`,
            }
          : {
              id: "caveman-cavecrew",
              status: "fail",
              message: `Caveman cavecrew is ${String(config.cavecrew)}, expected ${expectedCavecrew}`,
            },
      );

      const expectedCompress = selection.features.compress ?? false;
      checks.push(
        config.compress === expectedCompress
          ? {
              id: "caveman-compress",
              status: "pass",
              message: `Caveman compress is ${expectedCompress}`,
            }
          : {
              id: "caveman-compress",
              status: "fail",
              message: `Caveman compress is ${String(config.compress)}, expected ${expectedCompress}`,
            },
      );
    } catch {
      checks.push({
        id: "caveman-config",
        status: "warn",
        message: "Caveman config.json is not readable yet",
      });
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
    return [...new Set([...selected, cavemanConfigPath(context)])];
  }

  async uninstall(context: AdapterContext): Promise<InstallResult> {
    if (context.selectedAgents.includes("codex")) {
      const active = await getActiveCodexProcesses(context);
      if (active.length > 0) {
        return {
          succeeded: false,
          executed: [],
          skipped: [],
          errors: [
            `Active Codex processes detected targeting CODEX_HOME (PIDs: ${active.map((p) => p.pid).join(", ")}). Deferring Caveman Codex cleanup to prevent overwriting/conflicts.`,
          ],
        };
      }
    }
    // Only remove Don’t Waste marker files; do not run the upstream uninstaller (would touch user-managed skills).
    const targets = await this.uninstallPaths(context);
    const errors: string[] = [];
    if (!context.dryRun) {
      for (const file of targets) {
        if (file === cavemanConfigPath(context)) {
          try {
            const raw = await readFile(file, "utf8");
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            if (parsed[OWNED_MARKER] === true) {
              // File was created/owned by Don’t Waste — safe to remove entirely.
              await rm(file, { force: true });
            } else {
              // Preserve user-managed keys; only drop fields we wrote.
              const {
                defaultMode: _drop,
                cavecrew: _cc,
                compress: _cp,
                [OWNED_MARKER]: _owned,
                ...rest
              } = parsed;
              if (Object.keys(rest).length === 0)
                await rm(file, { force: true });
              else
                await writeFile(
                  file,
                  `${JSON.stringify(rest, null, 2)}\n`,
                  "utf8",
                );
            }
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
              errors.push(
                `Failed to clean up Caveman config: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }
        } else {
          try {
            await rm(file, { force: true });
          } catch (error) {
            errors.push(
              `Failed to remove ${file}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
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
            label: `Remove Caveman marker/config ${file}`,
          }))
        : [],
      errors,
    };
  }
}

async function ensureSkillLinked(
  agent: AgentId,
  context: Pick<AdapterContext, "home">,
): Promise<string | undefined> {
  const globalSkillDir = cavemanGlobalSkillDir(context);
  const targetDir = cavemanSkillTargetDir(agent, context);
  if (!targetDir) return undefined;

  try {
    await access(path.join(globalSkillDir, "SKILL.md"));
  } catch {
    return `Global Caveman skill is missing at ${globalSkillDir}`;
  }

  const state = await cavemanSkillLinkState(agent, context);
  if (state === "canonical" || state === "external") return undefined;
  if (state === "conflict") return cavemanSkillConflictMessage(agent, context);

  try {
    await mkdir(path.dirname(targetDir), { recursive: true });
    await symlink(globalSkillDir, targetDir, "dir");
    return undefined;
  } catch (error) {
    return `Failed to link Caveman skill for ${agent}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function cavemanSkillHealthCheck(
  agent: "codex" | "antigravity-cli",
  context: Pick<AdapterContext, "home">,
): Promise<HealthCheck> {
  const file =
    agent === "codex"
      ? cavemanCodexSkillPath(context)
      : cavemanAntigravitySkillPath(context);
  const label = agent === "codex" ? "Codex" : "Antigravity";
  const state = await cavemanSkillLinkState(agent, context);
  const isPass = await hasCanonicalCavemanSkillLink(agent, context);

  const mcpExplanatoryNote =
    agent === "codex"
      ? ". Note: Caveman is a Codex skill and does not register as an MCP server; checking '/mcp' inside Codex will NOT show Caveman. Instead, run '/caveman' in a Codex session to activate/verify it."
      : ". Note: Caveman is an Antigravity skill and does not register as an MCP server.";

  return isPass
    ? {
        id: `caveman-${agent === "codex" ? "codex" : "antigravity"}-skill`,
        status: "pass",
        message:
          (state === "canonical"
            ? `${label} Caveman skill is linked to the canonical global skill at ${file}`
            : `${label} Caveman skill is linked to a valid external skill source at ${file}`) +
          mcpExplanatoryNote,
      }
    : {
        id: `caveman-${agent === "codex" ? "codex" : "antigravity"}-skill`,
        status: "fail",
        message:
          `${label} Caveman skill is not linked to the canonical global skill at ${file}` +
          mcpExplanatoryNote,
        remediation:
          "Preserve the existing skill target, resolve the conflict, then rerun dont-waste init and start a new session.",
      };
}
