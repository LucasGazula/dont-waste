import { existsSync } from "node:fs";
import process from "node:process";
import {
  cancel,
  confirm,
  intro,
  isCancel,
  multiselect,
  note,
  outro,
  select,
  spinner,
} from "@clack/prompts";
import {
  createAdapters,
  detectAgents,
  configuredToolsFromConfig,
  shouldActivateIntegration,
  type AdapterContext,
  type Command as AdapterCommand,
  type InstallResult,
  type OperationPlan,
  type ToolSelection,
} from "@dont-waste/adapters";
import {
  agents,
  balancedSelection,
  toolIds,
  type AgentId,
  type Mode,
  type ToolId,
} from "@dont-waste/catalog";
import {
  createOperation,
  getDataPaths,
  readConfig,
  restoreOperation,
  setIntegration,
  updateOperation,
  withOperationSignalGuards,
  writeConfig,
  type DontWasteConfig,
} from "@dont-waste/core";
import { createDashboardServer } from "@dont-waste/dashboard-api";
import { TelemetryStore, aggregateEvents } from "@dont-waste/telemetry";
import { Command } from "commander";
import { execa } from "execa";
import {
  browserOpenCommand,
  formatDashboardReady,
  resolveDashboardStaticDir,
} from "./dashboard-launch.js";
import {
  mainMenuOptions,
  shouldOpenMainMenu,
  type MenuAction,
} from "./menu.js";
import { formatPlanSummary } from "./plan-summary.js";
import {
  compareUpdates,
  toolsNeedingUpdate,
  type ReleaseInfo,
} from "./updates.js";

type CommonOptions = { dryRun?: boolean; json?: boolean; yes?: boolean };
type InitOptions = CommonOptions & {
  profile?: Profile;
  channel?: "pinned" | "latest";
};
type DashboardOptions = CommonOptions & { port?: string; open: boolean };
type Profile = "balanced" | "maximum-savings" | "custom" | "install-only";
type InitRequest = {
  profile: Profile;
  channel: "pinned" | "latest";
  selectedAgents: AgentId[];
  selections: Record<ToolId, ToolSelection>;
};
type PlanResult = {
  request: InitRequest;
  plans: OperationPlan[];
  diagnostics: Awaited<ReturnType<typeof detectAgents>>;
};

const packageVersion = "0.1.0";
const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
/** Caveman/Ponytail detect markers/config; their Node banners are not upstream releases. */
const nodeBackedTools = new Set<ToolId>(["caveman", "ponytail"]);

function context(
  selectedAgents: AgentId[],
  dryRun: boolean,
  beforeCommand?: (command: AdapterCommand) => void | Promise<void>,
  abortSignal?: AbortSignal,
): AdapterContext {
  return {
    platform: process.platform,
    home,
    selectedAgents,
    dryRun,
    beforeCommand,
    abortSignal,
  };
}
function result(value: unknown, options: CommonOptions): void {
  if (options.json) console.log(JSON.stringify(value, null, 2));
  else if (typeof value === "string") console.log(value);
  else console.log(render(value));
}
function render(value: unknown): string {
  if (Array.isArray(value)) return value.map(render).join("\n");
  if (value && typeof value === "object")
    return Object.entries(value as Record<string, unknown>)
      .map(
        ([key, item]) =>
          `${key}: ${typeof item === "object" ? JSON.stringify(item) : String(item)}`,
      )
      .join("\n");
  return String(value);
}
function requireConfirmation(options: CommonOptions): void {
  if (!options.yes && !options.dryRun && !process.stdin.isTTY)
    throw new Error(
      "Refusing to modify this machine without a terminal. Re-run with --yes after reviewing --dry-run.",
    );
}
function checked<T>(value: T | symbol): T {
  if (isCancel(value)) {
    cancel("Operation cancelled.");
    process.exit(0);
  }
  return value as T;
}
function defaultSelections(profile: Profile): Record<ToolId, ToolSelection> {
  const modes = balancedSelection();
  if (profile === "maximum-savings") modes.caveman = "ultra";
  if (profile === "install-only")
    return Object.fromEntries(
      toolIds.map((tool) => [tool, { mode: "full", features: {} }]),
    ) as Record<ToolId, ToolSelection>;
  return Object.fromEntries(
    toolIds.map((tool) => [
      tool,
      {
        mode: modes[tool],
        features:
          tool === "headroom"
            ? {
                outputShaper: profile === "maximum-savings",
                ccrTtl: profile === "maximum-savings",
              }
            : tool === "rtk"
              ? { ultraCompact: profile === "maximum-savings" }
              : {},
      },
    ]),
  ) as Record<ToolId, ToolSelection>;
}

/** Preserve custom modes/features already saved in config when planning updates. */
function selectionsFromConfig(
  config: DontWasteConfig,
): Record<ToolId, ToolSelection> {
  const selections = defaultSelections(config.profile);
  for (const tools of Object.values(config.integrations)) {
    if (!tools) continue;
    for (const tool of toolIds) {
      const settings = tools[tool];
      if (settings?.enabled && settings.mode !== "off") {
        selections[tool] = {
          mode: settings.mode,
          features: settings.features ?? {},
        };
      }
    }
  }
  return selections;
}

async function interactiveRequest(
  options: InitOptions,
  diagnostics: Awaited<ReturnType<typeof detectAgents>>,
): Promise<InitRequest> {
  const detected = diagnostics
    .filter((item) => item.detected || item.existingConfigs.length > 0)
    .map((item) => item.agent);
  if (options.yes || options.dryRun || !process.stdin.isTTY) {
    const profile = options.profile ?? "balanced";
    return {
      profile,
      channel: options.channel ?? "pinned",
      selectedAgents: detected,
      selections: defaultSelections(profile),
    };
  }
  intro("Don’t Waste setup");
  note(
    diagnostics
      .map(
        (agent) =>
          `${agent.agent.padEnd(16)} ${agent.detected ? `found ${agent.version ?? ""}` : "not on PATH"}${agent.existingConfigs.length ? ` · config: ${agent.existingConfigs.join(", ")}` : ""}`,
      )
      .join("\n"),
    "Environment diagnosis",
  );
  const profile = checked(
    await select({
      message: "Choose a profile",
      initialValue: options.profile ?? "balanced",
      options: [
        {
          value: "balanced",
          label: "Balanced",
          hint: "RTK + Headroom where compatible; Caveman and Ponytail full",
        },
        {
          value: "maximum-savings",
          label: "Maximum savings",
          hint: "aggressive output shaping and ultra compact RTK",
        },
        { value: "custom", label: "Custom", hint: "choose tools and modes" },
        {
          value: "install-only",
          label: "Install only",
          hint: "do not activate agent integrations",
        },
      ],
    }),
  ) as Profile;
  const selectedAgents = checked(
    await multiselect({
      message: "Which detected agents should be configured?",
      options: diagnostics.map((agent) => ({
        value: agent.agent,
        label:
          agents.find((item) => item.id === agent.agent)?.label ?? agent.agent,
        ...(agent.detected && agent.version
          ? { hint: agent.version }
          : { hint: "configuration found" }),
      })) as never,
      initialValues: detected,
    }),
  ) as AgentId[];
  const selections = defaultSelections(profile);
  if (profile !== "install-only") {
    for (const tool of toolIds) {
      const current = selections[tool]!;
      const enabled = checked(
        await confirm({
          message: `${tool}: ${tool === "headroom" ? "compress context through proxy/MCP" : tool === "rtk" ? "compact shell outputs before they reach the agent" : tool === "caveman" ? "reduce agent response verbosity" : "enforce the minimal engineering ladder"}`,
          initialValue: current.mode !== "off",
        }),
      );
      if (!enabled) {
        selections[tool] = { mode: "off", features: {} };
        continue;
      }
      if (tool === "caveman") {
        const mode = checked(
          await select({
            message: "Caveman default mode",
            initialValue: current.mode === "off" ? "full" : current.mode,
            options: [
              {
                value: "lite",
                label: "lite",
                hint: "short answers with more explanation",
              },
              {
                value: "full",
                label: "full",
                hint: "recommended direct fragments",
              },
              { value: "ultra", label: "ultra", hint: "maximum concision" },
              {
                value: "wenyan",
                label: "wenyan",
                hint: "classical Chinese; intentionally changes language",
              },
            ],
          }),
        ) as Mode;
        const statusline = checked(
          await confirm({
            message: "Enable Caveman savings statusline?",
            initialValue: false,
          }),
        );
        const cavecrew = checked(
          await confirm({
            message: "Enable Cavecrew subagents?",
            initialValue: false,
          }),
        );
        const compress = checked(
          await confirm({
            message: "Enable Caveman-compress for memory/instructions?",
            initialValue: false,
          }),
        );
        selections[tool] = {
          mode,
          features: { statusline, cavecrew, compress },
        };
      }
      if (tool === "ponytail") {
        const mode = checked(
          await select({
            message: "Ponytail default mode",
            initialValue: current.mode === "wenyan" ? "full" : current.mode,
            options: ["lite", "full", "ultra"].map((value) => ({
              value,
              label: value,
            })),
          }),
        ) as Mode;
        selections[tool] = { mode, features: {} };
      }
      if (tool === "headroom") {
        const outputShaper = checked(
          await confirm({
            message:
              "Enable Headroom output shaping? Savings are estimated without a holdout.",
            initialValue: Boolean(current.features.outputShaper),
          }),
        );
        const ccrTtl = checked(
          await confirm({
            message:
              "Extend Headroom CCR cache TTL (HEADROOM_CCR_TTL_SECONDS=7200) for long runs?",
            initialValue: Boolean(current.features.ccrTtl),
          }),
        );
        selections[tool] = {
          ...current,
          features: {
            ...current.features,
            outputShaper,
            ccrTtl,
          },
        };
      }
      if (tool === "rtk") {
        const ultraCompact = checked(
          await confirm({
            message: "Use RTK ultra-compact direct-command mode?",
            initialValue: Boolean(current.features.ultraCompact),
          }),
        );
        selections[tool] = {
          ...current,
          features: { ...current.features, ultraCompact },
        };
      }
    }
  }
  const channel = checked(
    await select({
      message: "Update policy",
      initialValue: options.channel ?? "pinned",
      options: [
        {
          value: "pinned",
          label: "Pinned",
          hint: "record versions; never change them automatically",
        },
        {
          value: "latest",
          label: "Latest",
          hint: "check official releases and ask before applying",
        },
      ],
    }),
  ) as "pinned" | "latest";
  return { profile, channel, selectedAgents, selections };
}

async function makePlan(options: InitOptions): Promise<PlanResult> {
  const diagnostics = await detectAgents(context([], Boolean(options.dryRun)));
  const request = await interactiveRequest(options, diagnostics);
  const adapters = createAdapters();
  const plans: OperationPlan[] = [];
  for (const tool of toolIds) {
    const selection = request.selections[tool];
    if (!selection || selection.mode === "off") continue;
    plans.push(
      await adapters[tool].planInstall(
        selection,
        context(
          request.profile === "install-only" ? [] : request.selectedAgents,
          Boolean(options.dryRun),
        ),
      ),
    );
  }
  return { request, plans, diagnostics };
}

function planText(plan: PlanResult): string {
  return formatPlanSummary({
    profile: plan.request.profile,
    selectedAgents: plan.request.selectedAgents,
    plans: plan.plans,
  });
}

async function applyPlan(
  plan: PlanResult,
  operationType: "init" | "update",
  options: CommonOptions,
  progress?: {
    onProgress?: (message: string) => void;
    beforeCommand?: (command: AdapterCommand) => void | Promise<void>;
  },
): Promise<{ operationId?: string; results: unknown[]; checks: unknown[] }> {
  const paths = getDataPaths();
  if (options.dryRun)
    return {
      results: plan.plans.map((item) => ({
        tool: item.tool,
        status: "dry-run",
        commands: item.commands,
      })),
      checks: [],
    };
  const affected = [
    ...new Set([
      paths.config,
      ...plan.plans.flatMap((item) => item.affectedPaths),
    ]),
  ];
  const operation = await createOperation(
    paths,
    operationType,
    { request: plan.request, plans: plan.plans },
    affected,
  );
  await updateOperation(paths, operation.id, "running");
  const adapters = createAdapters();
  const results: Array<{
    tool: ToolId;
    succeeded: boolean;
    errors: string[];
    skippedInteractive: string[];
  }> = [];

  return withOperationSignalGuards(paths, operation.id, async ({ signal }) => {
    const installByTool = new Map<ToolId, InstallResult>();
    for (const toolPlan of plan.plans) {
      progress?.onProgress?.(`Installing ${toolPlan.tool}…`);
      const installed = await adapters[toolPlan.tool].install(
        toolPlan,
        context(
          plan.request.profile === "install-only"
            ? []
            : plan.request.selectedAgents,
          false,
          progress?.beforeCommand,
          signal,
        ),
      );
      installByTool.set(toolPlan.tool, installed);
      results.push({
        tool: toolPlan.tool,
        succeeded: installed.succeeded,
        errors: installed.errors,
        skippedInteractive: installed.skipped
          .filter((command) => command.interactive && !command.optional)
          .map((command) => command.label),
      });
      if (!installed.succeeded) throw new Error(installed.errors.join("; "));
    }
    progress?.onProgress?.("Verifying integrations…");
    const checks = await Promise.all(
      plan.plans.map(async (item) => ({
        tool: item.tool,
        checks: await adapters[item.tool].verify(
          plan.request.selections[item.tool]!,
          context(plan.request.selectedAgents, false, undefined, signal),
        ),
      })),
    );
    let config = await readConfig(paths);
    config = {
      ...config,
      profile: plan.request.profile,
      updateChannel: plan.request.channel,
    };
    const telemetry = await TelemetryStore.open(paths);
    for (const diagnostic of plan.diagnostics)
      telemetry.recordAgent(
        diagnostic.agent,
        diagnostic.existingConfigs[0],
        diagnostic.version,
      );
    for (const item of checks) {
      const selected = plan.request.selections[item.tool]!;
      const installed = installByTool.get(item.tool)!;
      const activate = shouldActivateIntegration({
        profile: plan.request.profile,
        checks: item.checks,
        install: installed,
      });
      if (activate) {
        for (const agent of plan.request.selectedAgents) {
          config = setIntegration(
            config,
            agent,
            item.tool,
            selected.mode,
            selected.features,
          );
          telemetry.recordIntegration(
            agent,
            item.tool,
            selected.features,
            "active",
            operation.id,
          );
        }
      } else if (plan.request.profile !== "install-only") {
        for (const agent of plan.request.selectedAgents) {
          telemetry.recordIntegration(
            agent,
            item.tool,
            selected.features,
            item.checks.some((check) => check.status === "fail") ||
              !installed.succeeded
              ? "failed"
              : "pending",
            operation.id,
          );
        }
      }
      const detection = await adapters[item.tool].detect(
        context(plan.request.selectedAgents, false, undefined, signal),
      );
      const version = nodeBackedTools.has(item.tool)
        ? undefined
        : detection.version;
      telemetry.recordInstallation(
        item.tool,
        version,
        plan.request.channel,
        activate ? "succeeded" : "failed",
      );
    }
    telemetry.recordOperation(
      operation.id,
      operationType,
      plan,
      "succeeded",
      operation.snapshotFile,
    );
    telemetry.close();
    await writeConfig(paths, config);
    await updateOperation(paths, operation.id, "succeeded");
    return { operationId: operation.id, results, checks };
  });
}

async function collect(paths = getDataPaths()): Promise<{
  imports: Array<{
    source: string;
    imported: number;
    error?: string;
    cursor?: string;
  }>;
  summary: ReturnType<typeof aggregateEvents>;
  projects: number;
  sessions: number;
}> {
  const config = await readConfig(paths);
  const selectedAgents = Object.keys(config.integrations) as AgentId[];
  const adapters = createAdapters();
  const store = await TelemetryStore.open(paths);
  for (const project of config.projects)
    store.upsertProject(project.path, project.alias);
  const imports: Array<{
    source: string;
    imported: number;
    error?: string;
    cursor?: string;
  }> = [];
  for (const tool of toolIds) {
    const imported = await adapters[tool].collectMetrics(
      context(selectedAgents, false),
    );
    const count = store.insertEvents(imported.events);
    for (const event of imported.events) {
      if (event.projectPath) store.upsertProject(event.projectPath);
      if (event.sessionId) {
        store.upsertSession({
          id: event.sessionId,
          agent: event.agentId,
          projectPath: event.projectPath,
          startedAt: event.occurredAt,
          metadata: event.model ? { model: event.model } : {},
        });
      }
    }
    const cursor = imported.error
      ? store.latestImportCursor(imported.source)
      : (imported.events
          .map((event) => event.occurredAt)
          .sort()
          .at(-1) ?? new Date().toISOString());
    store.recordImport(imported.source, count, imported.error, cursor);
    imports.push({
      source: imported.source,
      imported: count,
      ...(imported.error ? { error: imported.error } : {}),
      ...(cursor ? { cursor } : {}),
    });
  }
  const summary = aggregateEvents(store.listEvents());
  const projects = store.listProjects().length;
  const sessions = store.listSessions().length;
  store.close();
  return { imports, summary, projects, sessions };
}

async function officialUpdates(): Promise<ReleaseInfo[]> {
  const repositories: Record<ToolId, string> = {
    headroom: "headroomlabs-ai/headroom",
    rtk: "rtk-ai/rtk",
    caveman: "JuliusBrussee/caveman",
    ponytail: "DietrichGebert/ponytail",
  };
  return Promise.all(
    toolIds.map(async (tool) => {
      const url = `https://github.com/${repositories[tool]}/releases/latest`;
      try {
        const response = await fetch(
          `https://api.github.com/repos/${repositories[tool]}/releases/latest`,
          {
            headers: {
              Accept: "application/vnd.github+json",
              "User-Agent": "dont-waste",
            },
          },
        );
        if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
        const body = (await response.json()) as {
          tag_name?: string;
          html_url?: string;
        };
        return { tool, latest: body.tag_name, url: body.html_url ?? url };
      } catch (error) {
        return {
          tool,
          url,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
}

async function installedToolVersions(): Promise<
  Array<{ tool: ToolId; installed?: string | undefined; detected: boolean }>
> {
  const adapters = createAdapters();
  const paths = getDataPaths();
  const store = await TelemetryStore.open(paths);
  const result = await Promise.all(
    toolIds.map(async (tool) => {
      const detection = await adapters[tool].detect(context([], true));
      const recorded = store.latestInstallation(tool)?.version ?? undefined;
      const installed = nodeBackedTools.has(tool)
        ? recorded
        : (detection.version ?? recorded);
      return { tool, installed, detected: detection.detected };
    }),
  );
  store.close();
  return result;
}

async function makeUpdatePlan(
  options: CommonOptions,
  config: DontWasteConfig,
  onlyTools: ToolId[],
): Promise<PlanResult> {
  const selectedAgents = Object.keys(config.integrations) as AgentId[];
  const selections = selectionsFromConfig(config);
  const diagnostics = await detectAgents(context([], Boolean(options.dryRun)));
  const adapters = createAdapters();
  const plans: OperationPlan[] = [];
  for (const tool of onlyTools) {
    const selection = selections[tool];
    if (!selection || selection.mode === "off") continue;
    plans.push(
      await adapters[tool].planInstall(
        selection,
        context(
          config.profile === "install-only" ? [] : selectedAgents,
          Boolean(options.dryRun),
        ),
      ),
    );
  }
  return {
    request: {
      profile: config.profile,
      channel: config.updateChannel,
      selectedAgents,
      selections,
    },
    plans,
    diagnostics,
  };
}

async function runUpdate(options: CommonOptions): Promise<void> {
  const [releases, installed] = await Promise.all([
    officialUpdates(),
    installedToolVersions(),
  ]);
  const comparisons = compareUpdates(installed, releases);
  const needing = toolsNeedingUpdate(comparisons);
  const config = await readConfig(getDataPaths());
  if (!options.yes || options.dryRun) {
    return result(
      {
        dontWaste: packageVersion,
        updateChannel: config.updateChannel,
        comparisons,
        needingUpdate: needing,
        next:
          config.updateChannel === "pinned"
            ? "Channel is pinned: review release URLs above; switch updateChannel to latest before applying with --yes."
            : needing.length
              ? "Review release notes for tools marked update-available/not-installed; rerun with --yes to apply an idempotent plan only for those tools."
              : "All detected tools look up to date with the latest GitHub releases.",
      },
      options,
    );
  }
  requireConfirmation(options);
  if (config.updateChannel === "pinned") {
    return result(
      {
        dontWaste: packageVersion,
        updateChannel: "pinned",
        comparisons,
        applied: false,
        reason: "Refusing to apply updates while updateChannel is pinned.",
      },
      options,
    );
  }
  if (!needing.length) {
    return result(
      {
        dontWaste: packageVersion,
        comparisons,
        applied: false,
        reason: "nothing to update",
      },
      options,
    );
  }
  const setup = await makeUpdatePlan(options, config, needing);
  if (!options.json)
    note(planText(setup), "Update plan (tools needing changes only)");
  result(
    {
      comparisons,
      needingUpdate: needing,
      ...(await applyPlan(setup, "update", options)),
    },
    options,
  );
}

function addCommonOptions(command: Command): Command {
  return command
    .option("--dry-run", "show changes without modifying this machine")
    .option("--json", "write machine-readable JSON")
    .option("--yes", "skip confirmation after the plan is shown");
}

async function runInit(options: InitOptions): Promise<void> {
  requireConfirmation(options);
  const setup = await makePlan(options);
  if (!options.json) {
    note(planText(setup), "Planned changes");
    if (!options.dryRun && !options.yes) {
      const accepted = checked(
        await confirm({ message: "Apply this plan?", initialValue: false }),
      );
      if (!accepted) {
        cancel("No changes were made.");
        return;
      }
    }
  }
  const work = !options.json && !options.dryRun ? spinner() : undefined;
  let spinnerActive = false;
  const stopSpinner = (message?: string) => {
    if (!work || !spinnerActive) return;
    work.stop(message);
    spinnerActive = false;
  };
  const startSpinner = (message: string) => {
    if (!work) return;
    if (spinnerActive) work.stop();
    work.start(message);
    spinnerActive = true;
  };
  try {
    startSpinner("Applying plan");
    const applied = await applyPlan(setup, "init", options, {
      onProgress: (message) => startSpinner(message),
      beforeCommand: async (command) => {
        // Stop spinner so inherited stdio / prompts are visible; skip note for dry paths.
        stopSpinner(
          command.interactive
            ? `Skipping interactive: ${command.label}`
            : `Running: ${command.label}`,
        );
      },
    });
    stopSpinner("Plan finished");
    result({ plan: setup, ...applied }, options);
    if (!options.json && !options.dryRun)
      outro(
        `Done. Operation ${applied.operationId}. Run dont-waste collect after using an enabled agent.`,
      );
  } catch (error) {
    stopSpinner("Plan failed");
    throw error;
  } finally {
    stopSpinner();
  }
}

async function runStatus(options: CommonOptions): Promise<void> {
  const paths = getDataPaths();
  const config = await readConfig(paths);
  const diagnostics = await detectAgents(context([], true));
  const adapterDetections = await Promise.all(
    Object.values(createAdapters()).map((adapter) =>
      adapter.detect(context([], true)),
    ),
  );
  result({ config, agents: diagnostics, tools: adapterDetections }, options);
}

async function runDoctor(options: CommonOptions): Promise<void> {
  const paths = getDataPaths();
  const config = await readConfig(paths);
  const adapters = createAdapters();
  const configured = configuredToolsFromConfig(config);
  const checks = [];
  for (const tool of toolIds) {
    const entry = configured.find((item) => item.tool === tool);
    if (!entry) {
      checks.push({
        tool,
        status: "skipped",
        reason: "not enabled in Don’t Waste config",
        checks: [],
      });
      continue;
    }
    const toolChecks = await adapters[tool].verify(
      entry.selection,
      context(entry.agents, true),
    );
    const failed = toolChecks.some((check) => check.status === "fail");
    const warned = toolChecks.some((check) => check.status === "warn");
    checks.push({
      tool,
      status: failed ? "fail" : warned ? "warn" : "pass",
      selection: entry.selection,
      agents: entry.agents,
      checks: toolChecks,
    });
  }
  const database = await TelemetryStore.open(paths);
  database.close();
  const overall = checks.some((item) => item.status === "fail")
    ? "fail"
    : checks.some((item) => item.status === "warn")
      ? "warn"
      : "pass";
  result(
    { overall, checks, database: { status: "pass", path: paths.database } },
    options,
  );
}

async function runCollect(options: CommonOptions): Promise<void> {
  if (options.dryRun)
    return result(
      {
        dryRun: true,
        sources: [
          "rtk gain",
          "headroom perf",
          "caveman explicit stats file",
          "ponytail (unavailable)",
        ],
      },
      options,
    );
  result(await collect(), options);
}

async function runDashboard(options: DashboardOptions): Promise<void> {
  const staticDir = resolveDashboardStaticDir({
    cwd: process.cwd(),
    envAssets: process.env.DONT_WASTE_DASHBOARD_ASSETS,
    existsSync,
  });
  // Listen and print the URL before any slow collect so the API is usable immediately.
  const dashboard = await createDashboardServer(getDataPaths(), {
    port: options.port ? Number(options.port) : undefined,
    staticDir,
    host: process.env.DONT_WASTE_DASHBOARD_HOST,
  });
  const ready = formatDashboardReady(dashboard.url, Boolean(staticDir));
  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({ url: dashboard.url, staticAssets: Boolean(staticDir) }, null, 2)}\n`,
    );
  } else {
    note(ready, "Dashboard");
    process.stdout.write(`${dashboard.url}\n`);
  }
  if (options.open) {
    const opener = browserOpenCommand(process.platform, dashboard.url);
    void execa(opener.command, opener.args, { reject: false, detached: true });
  }
  if (!options.dryRun) {
    void collect().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!options.json) console.error(`Background collect failed: ${message}`);
    });
  }
  const close = async () => {
    await dashboard.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
  await new Promise<void>(() => undefined);
}

async function runRollback(id: string, options: CommonOptions): Promise<void> {
  if (options.dryRun) return result({ dryRun: true, operation: id }, options);
  requireConfirmation(options);
  if (
    !options.yes &&
    process.stdin.isTTY &&
    !checked(
      await confirm({
        message: `Restore snapshot ${id}?`,
        initialValue: false,
      }),
    )
  )
    return;
  const operation = await restoreOperation(getDataPaths(), id);
  result({ restored: id, operation }, options);
}

async function runUninstall(options: CommonOptions): Promise<void> {
  if (options.dryRun)
    return result(
      {
        dryRun: true,
        action:
          "snapshot altered paths, remove marker-owned files, clear Don’t Waste integrations; telemetry stays local; use rollback <id> for a specific snapshot",
      },
      options,
    );
  requireConfirmation(options);
  if (
    !options.yes &&
    process.stdin.isTTY &&
    !checked(
      await confirm({
        message:
          "Remove managed integrations and clear Don’t Waste activation state?",
        initialValue: false,
      }),
    )
  )
    return;
  const paths = getDataPaths();
  const config = await readConfig(paths);
  const selectedAgents = Object.keys(config.integrations) as AgentId[];
  const adapters = createAdapters();
  const ctx = context(selectedAgents, false);
  const affected = [
    ...new Set([
      paths.config,
      ...(
        await Promise.all(
          toolIds.map((tool) => adapters[tool].uninstallPaths(ctx)),
        )
      ).flat(),
    ]),
  ];
  const operation = await createOperation(
    paths,
    "uninstall",
    { selectedAgents, affected },
    affected,
  );
  await updateOperation(paths, operation.id, "running");
  try {
    const adapterResults = await withOperationSignalGuards(
      paths,
      operation.id,
      async ({ signal }) => {
        const guardedCtx = context(selectedAgents, false, undefined, signal);
        const results = [];
        for (const tool of toolIds) {
          const uninstallResult = await adapters[tool].uninstall(guardedCtx);
          results.push({ tool, ...uninstallResult });
          if (!uninstallResult.succeeded) {
            throw new Error(
              `${tool}: ${uninstallResult.errors.join("; ") || "uninstall failed"}`,
            );
          }
        }
        await writeConfig(paths, {
          ...config,
          integrations: {},
          profile: "install-only",
        });
        await updateOperation(paths, operation.id, "succeeded");
        return results;
      },
    );
    result(
      {
        operation: operation.id,
        succeeded: true,
        adapters: adapterResults,
        clearedIntegrations: selectedAgents,
        affectedPaths: affected,
        telemetry: "preserved",
        note: "Only marker-owned Don’t Waste files were removed. Use dont-waste rollback <id> if you need a specific pre-init file state.",
      },
      options,
    );
  } catch (error) {
    result(
      {
        operation: operation.id,
        succeeded: false,
        restoredSnapshot: true,
        error: error instanceof Error ? error.message : String(error),
        note: "Uninstall failed; previous files were restored from the operation snapshot.",
      },
      options,
    );
    process.exitCode = 1;
  }
}

async function runMainMenu(): Promise<void> {
  intro("Don’t Waste");
  note(
    "Use arrow keys to choose an action. Existing CLI commands still work directly.",
    "Terminal UI",
  );
  for (;;) {
    const action = checked(
      await select({
        message: "What do you want to do?",
        options: mainMenuOptions,
      }),
    ) as MenuAction;
    if (action === "exit") {
      outro("Bye.");
      return;
    }
    if (action === "dashboard") {
      const openBrowser = checked(
        await confirm({
          message: "Open the dashboard in your browser?",
          initialValue: true,
        }),
      );
      await runDashboard({ open: openBrowser });
      return;
    }
    if (action === "init") {
      await runInit({});
      outro("Back at the menu next time you run dont-waste with no arguments.");
      return;
    }
    if (action === "status") await runStatus({});
    else if (action === "doctor") await runDoctor({});
    else if (action === "collect") await runCollect({});
    else if (action === "update") await runUpdate({});
    else if (action === "uninstall") await runUninstall({});
    note("Choose another action, or Exit.", "Done");
  }
}

const program = new Command();
program
  .name("dont-waste")
  .description("Local-first token reduction orchestrator for coding agents")
  .version(packageVersion);

program
  .command("menu")
  .description("open the interactive terminal menu")
  .action(async () => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error(
        "The interactive menu needs a terminal. Use dont-waste --help for direct commands.",
      );
    }
    await runMainMenu();
  });

addCommonOptions(
  program
    .command("init")
    .description("detect, plan, install, and validate integrations")
    .option(
      "--profile <profile>",
      "balanced, maximum-savings, custom, or install-only",
    )
    .option("--channel <channel>", "pinned or latest"),
).action(async (options: InitOptions) => {
  await runInit(options);
});

addCommonOptions(
  program
    .command("status")
    .description("show configured tools, agents, profile, and health"),
).action(async (options: CommonOptions) => {
  await runStatus(options);
});

addCommonOptions(
  program
    .command("doctor")
    .description("revalidate binaries, PATH, database, and integrations"),
).action(async (options: CommonOptions) => {
  await runDoctor(options);
});

addCommonOptions(
  program
    .command("collect")
    .description("import available local metrics from enabled upstream tools"),
).action(async (options: CommonOptions) => {
  await runCollect(options);
});

addCommonOptions(
  program
    .command("dashboard")
    .description("collect metrics and start the local dashboard")
    .option("--port <port>", "bind this local port")
    .option("--no-open", "do not open the browser"),
).action(async (options: DashboardOptions) => {
  await runDashboard(options);
});

addCommonOptions(
  program
    .command("update")
    .description(
      "check official upstream releases and apply an idempotent upgrade plan",
    ),
).action(async (options: CommonOptions) => {
  await runUpdate(options);
});

addCommonOptions(
  program
    .command("rollback <id>")
    .description("restore the configuration snapshot from an operation"),
).action(async (id: string, options: CommonOptions) => {
  await runRollback(id, options);
});

addCommonOptions(
  program
    .command("uninstall")
    .description(
      "remove Don’t Waste managed integrations without deleting upstream tools adopted from the user",
    ),
).action(async (options: CommonOptions) => {
  await runUninstall(options);
});

async function main(): Promise<void> {
  if (
    shouldOpenMainMenu(process.argv, {
      stdinIsTTY: Boolean(process.stdin.isTTY),
      stdoutIsTTY: Boolean(process.stdout.isTTY),
    })
  ) {
    await runMainMenu();
    return;
  }
  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

export { collect, makePlan, runMainMenu };
export {
  compareUpdates,
  normalizeVersion,
  toolsNeedingUpdate,
} from "./updates.js";
export { mainMenuOptions, shouldOpenMainMenu } from "./menu.js";
export {
  browserOpenCommand,
  formatDashboardReady,
  resolveDashboardStaticDir,
} from "./dashboard-launch.js";
