import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { cancel, confirm, intro, isCancel, multiselect, note, outro, select, spinner } from "@clack/prompts";
import { createAdapters, detectAgents, type AdapterContext, type OperationPlan, type ToolSelection } from "@dont-waste/adapters";
import { agentIds, agents, balancedSelection, toolIds, type AgentId, type Mode, type ToolId } from "@dont-waste/catalog";
import { createOperation, getDataPaths, readConfig, restoreOperation, setIntegration, updateOperation, writeConfig } from "@dont-waste/core";
import { createDashboardServer } from "@dont-waste/dashboard-api";
import { TelemetryStore, aggregateEvents } from "@dont-waste/telemetry";
import { Command, Option } from "commander";
import { execa } from "execa";

type CommonOptions = { dryRun?: boolean; json?: boolean; yes?: boolean };
type InitOptions = CommonOptions & { profile?: Profile; channel?: "pinned" | "latest" };
type Profile = "balanced" | "maximum-savings" | "custom" | "install-only";
type InitRequest = { profile: Profile; channel: "pinned" | "latest"; selectedAgents: AgentId[]; selections: Record<ToolId, ToolSelection> };
type PlanResult = { request: InitRequest; plans: OperationPlan[]; diagnostics: Awaited<ReturnType<typeof detectAgents>> };

const packageVersion = "0.1.0";
const home = process.env.HOME ?? process.env.USERPROFILE ?? "";

function context(selectedAgents: AgentId[], dryRun: boolean): AdapterContext {
  return { platform: process.platform, home, selectedAgents, dryRun };
}
function result(value: unknown, options: CommonOptions): void {
  if (options.json) console.log(JSON.stringify(value, null, 2));
  else if (typeof value === "string") console.log(value);
  else console.log(render(value));
}
function render(value: unknown): string {
  if (Array.isArray(value)) return value.map(render).join("\n");
  if (value && typeof value === "object") return Object.entries(value as Record<string, unknown>).map(([key, item]) => `${key}: ${typeof item === "object" ? JSON.stringify(item) : String(item)}`).join("\n");
  return String(value);
}
function requireConfirmation(options: CommonOptions): void {
  if (!options.yes && !options.dryRun && !process.stdin.isTTY) throw new Error("Refusing to modify this machine without a terminal. Re-run with --yes after reviewing --dry-run.");
}
function checked<T>(value: T | symbol): T {
  if (isCancel(value)) { cancel("Operation cancelled."); process.exit(0); }
  return value as T;
}
function defaultSelections(profile: Profile): Record<ToolId, ToolSelection> {
  const modes = balancedSelection();
  if (profile === "maximum-savings") modes.caveman = "ultra";
  if (profile === "install-only") return Object.fromEntries(toolIds.map((tool) => [tool, { mode: "full", features: {} }])) as Record<ToolId, ToolSelection>;
  return Object.fromEntries(toolIds.map((tool) => [tool, { mode: modes[tool], features: tool === "headroom" ? { outputShaper: profile === "maximum-savings" } : tool === "rtk" ? { ultraCompact: profile === "maximum-savings" } : {} }])) as Record<ToolId, ToolSelection>;
}

async function interactiveRequest(options: InitOptions, diagnostics: Awaited<ReturnType<typeof detectAgents>>): Promise<InitRequest> {
  const detected = diagnostics.filter((item) => item.detected || item.existingConfigs.length > 0).map((item) => item.agent);
  if (options.yes || options.dryRun || !process.stdin.isTTY) {
    const profile = options.profile ?? "balanced";
    return { profile, channel: options.channel ?? "pinned", selectedAgents: detected, selections: defaultSelections(profile) };
  }
  intro("Don’t Waste setup");
  note(diagnostics.map((agent) => `${agent.agent.padEnd(16)} ${agent.detected ? `found ${agent.version ?? ""}` : "not on PATH"}${agent.existingConfigs.length ? ` · config: ${agent.existingConfigs.join(", ")}` : ""}`).join("\n"), "Environment diagnosis");
  const profile = checked(await select({ message: "Choose a profile", initialValue: options.profile ?? "balanced", options: [
    { value: "balanced", label: "Balanced", hint: "RTK + Headroom where compatible; Caveman and Ponytail full" },
    { value: "maximum-savings", label: "Maximum savings", hint: "aggressive output shaping and ultra compact RTK" },
    { value: "custom", label: "Custom", hint: "choose tools and modes" },
    { value: "install-only", label: "Install only", hint: "do not activate agent integrations" },
  ] })) as Profile;
  const selectedAgents = checked(await multiselect({ message: "Which detected agents should be configured?", options: diagnostics.map((agent) => ({ value: agent.agent, label: agents.find((item) => item.id === agent.agent)?.label ?? agent.agent, ...(agent.detected && agent.version ? { hint: agent.version } : { hint: "configuration found" }) })) as never, initialValues: detected })) as AgentId[];
  const selections = defaultSelections(profile);
  if (profile !== "install-only") {
    for (const tool of toolIds) {
      const current = selections[tool]!;
      const enabled = checked(await confirm({ message: `${tool}: ${tool === "headroom" ? "compress context through proxy/MCP" : tool === "rtk" ? "compact shell outputs before they reach the agent" : tool === "caveman" ? "reduce agent response verbosity" : "enforce the minimal engineering ladder"}`, initialValue: current.mode !== "off" }));
      if (!enabled) { selections[tool] = { mode: "off", features: {} }; continue; }
      if (tool === "caveman") {
        const mode = checked(await select({ message: "Caveman default mode", initialValue: current.mode === "off" ? "full" : current.mode, options: [
          { value: "lite", label: "lite", hint: "short answers with more explanation" },
          { value: "full", label: "full", hint: "recommended direct fragments" },
          { value: "ultra", label: "ultra", hint: "maximum concision" },
          { value: "wenyan", label: "wenyan", hint: "classical Chinese; intentionally changes language" },
        ] })) as Mode;
        const statusline = checked(await confirm({ message: "Enable Caveman savings statusline?", initialValue: false }));
        selections[tool] = { mode, features: { statusline } };
      }
      if (tool === "ponytail") {
        const mode = checked(await select({ message: "Ponytail default mode", initialValue: current.mode === "wenyan" ? "full" : current.mode, options: ["lite", "full", "ultra"].map((value) => ({ value, label: value })) })) as Mode;
        selections[tool] = { mode, features: {} };
      }
      if (tool === "headroom") {
        const outputShaper = checked(await confirm({ message: "Enable Headroom output shaping? Savings are estimated without a holdout.", initialValue: Boolean(current.features.outputShaper) }));
        selections[tool] = { ...current, features: { ...current.features, outputShaper } };
      }
      if (tool === "rtk") {
        const ultraCompact = checked(await confirm({ message: "Use RTK ultra-compact direct-command mode?", initialValue: Boolean(current.features.ultraCompact) }));
        selections[tool] = { ...current, features: { ...current.features, ultraCompact } };
      }
    }
  }
  const channel = checked(await select({ message: "Update policy", initialValue: options.channel ?? "pinned", options: [
    { value: "pinned", label: "Pinned", hint: "record versions; never change them automatically" },
    { value: "latest", label: "Latest", hint: "check official releases and ask before applying" },
  ] })) as "pinned" | "latest";
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
    plans.push(await adapters[tool].planInstall(selection, context(request.profile === "install-only" ? [] : request.selectedAgents, Boolean(options.dryRun))));
  }
  return { request, plans, diagnostics };
}

function planText(plan: PlanResult): string {
  const tools = plan.plans.map((item) => `${item.tool}:\n${item.commands.map((command) => `  ${command.interactive ? "[interactive] " : ""}${command.command} ${command.args.join(" ")}`).join("\n") || "  already installed / no command"}${item.warnings.length ? `\n  warnings: ${item.warnings.join(" · ")}` : ""}`).join("\n\n");
  const agentsText = plan.request.selectedAgents.join(", ") || "none (install-only)";
  return `Profile: ${plan.request.profile}\nAgents: ${agentsText}\n\n${tools}`;
}

async function applyPlan(plan: PlanResult, operationType: "init" | "update", options: CommonOptions): Promise<{ operationId?: string; results: unknown[]; checks: unknown[] }> {
  const paths = getDataPaths();
  if (options.dryRun) return { results: plan.plans.map((item) => ({ tool: item.tool, status: "dry-run", commands: item.commands })), checks: [] };
  const affected = [...new Set([paths.config, ...plan.plans.flatMap((item) => item.affectedPaths)])];
  const operation = await createOperation(paths, operationType, { request: plan.request, plans: plan.plans }, affected);
  await updateOperation(paths, operation.id, "running");
  const adapters = createAdapters();
  const results: Array<{ tool: ToolId; succeeded: boolean; errors: string[] }> = [];
  try {
    for (const toolPlan of plan.plans) {
      const installed = await adapters[toolPlan.tool].install(toolPlan, context(plan.request.profile === "install-only" ? [] : plan.request.selectedAgents, false));
      results.push({ tool: toolPlan.tool, succeeded: installed.succeeded, errors: installed.errors });
      if (!installed.succeeded) throw new Error(installed.errors.join("; "));
    }
    const checks = await Promise.all(plan.plans.map(async (item) => ({ tool: item.tool, checks: await adapters[item.tool].verify(plan.request.selections[item.tool]!, context(plan.request.selectedAgents, false)) })));
    let config = await readConfig(paths);
    config = { ...config, profile: plan.request.profile, updateChannel: plan.request.channel };
    const telemetry = await TelemetryStore.open(paths);
    for (const diagnostic of plan.diagnostics) telemetry.recordAgent(diagnostic.agent, diagnostic.existingConfigs[0], diagnostic.version);
    for (const item of checks) {
      const failed = item.checks.some((check) => check.status === "fail");
      const selected = plan.request.selections[item.tool]!;
      if (plan.request.profile !== "install-only" && !failed) for (const agent of plan.request.selectedAgents) {
        config = setIntegration(config, agent, item.tool, selected.mode, selected.features);
        telemetry.recordIntegration(agent, item.tool, selected.features, item.checks.some((check) => check.status === "warn") ? "pending" : "active", operation.id);
      }
      telemetry.recordInstallation(item.tool, plan.diagnostics.find((entry) => entry.id === item.tool)?.version, plan.request.channel, failed ? "failed" : "succeeded");
    }
    telemetry.recordOperation(operation.id, operationType, plan, "succeeded", operation.snapshotFile);
    telemetry.close();
    await writeConfig(paths, config);
    await updateOperation(paths, operation.id, "succeeded");
    return { operationId: operation.id, results, checks };
  } catch (error) {
    await restoreOperation(paths, operation.id);
    await updateOperation(paths, operation.id, "failed", error instanceof Error ? error.message : String(error));
    throw error;
  }
}

async function collect(paths = getDataPaths()): Promise<{ imports: Array<{ source: string; imported: number; error?: string }>; summary: ReturnType<typeof aggregateEvents> }> {
  const config = await readConfig(paths);
  const selectedAgents = Object.keys(config.integrations) as AgentId[];
  const adapters = createAdapters();
  const store = await TelemetryStore.open(paths);
  const imports: Array<{ source: string; imported: number; error?: string }> = [];
  for (const tool of toolIds) {
    const imported = await adapters[tool].collectMetrics(context(selectedAgents, false));
    const count = store.insertEvents(imported.events);
    store.recordImport(imported.source, count, imported.error);
    imports.push({ source: imported.source, imported: count, ...(imported.error ? { error: imported.error } : {}) });
  }
  const summary = aggregateEvents(store.listEvents());
  store.close();
  return { imports, summary };
}

async function officialUpdates(): Promise<Array<{ tool: ToolId; version?: string | undefined; url: string; error?: string | undefined }>> {
  const repositories: Record<ToolId, string> = {
    headroom: "headroomlabs-ai/headroom", rtk: "rtk-ai/rtk", caveman: "JuliusBrussee/caveman", ponytail: "DietrichGebert/ponytail",
  };
  return Promise.all(toolIds.map(async (tool) => {
    const url = `https://github.com/${repositories[tool]}/releases/latest`;
    try {
      const response = await fetch(`https://api.github.com/repos/${repositories[tool]}/releases/latest`, { headers: { Accept: "application/vnd.github+json" } });
      if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
      const body = await response.json() as { tag_name?: string; html_url?: string };
      return { tool, version: body.tag_name, url: body.html_url ?? url };
    } catch (error) { return { tool, url, error: error instanceof Error ? error.message : String(error) }; }
  }));
}

function addCommonOptions(command: Command): Command {
  return command.option("--dry-run", "show changes without modifying this machine").option("--json", "write machine-readable JSON").option("--yes", "skip confirmation after the plan is shown");
}

const program = new Command();
program.name("dont-waste").description("Local-first token reduction orchestrator for coding agents").version(packageVersion);

addCommonOptions(program.command("init").description("detect, plan, install, and validate integrations").option("--profile <profile>", "balanced, maximum-savings, custom, or install-only").option("--channel <channel>", "pinned or latest")).action(async (options: InitOptions) => {
  requireConfirmation(options);
  const setup = await makePlan(options);
  if (!options.json) {
    note(planText(setup), "Planned changes");
    if (!options.dryRun && !options.yes) {
      const accepted = checked(await confirm({ message: "Apply this plan?", initialValue: false }));
      if (!accepted) { cancel("No changes were made."); return; }
    }
  }
  const work = !options.json && !options.dryRun ? spinner() : undefined;
  work?.start("Applying plan");
  const applied = await applyPlan(setup, "init", options);
  work?.stop("Plan finished");
  result({ plan: setup, ...applied }, options);
  if (!options.json && !options.dryRun) outro(`Done. Operation ${applied.operationId}. Run dont-waste collect after using an enabled agent.`);
});

addCommonOptions(program.command("status").description("show configured tools, agents, profile, and health")).action(async (options: CommonOptions) => {
  const paths = getDataPaths();
  const config = await readConfig(paths);
  const diagnostics = await detectAgents(context([], true));
  const adapterDetections = await Promise.all(Object.values(createAdapters()).map((adapter) => adapter.detect(context([], true))));
  result({ config, agents: diagnostics, tools: adapterDetections }, options);
});

addCommonOptions(program.command("doctor").description("revalidate binaries, PATH, database, and integrations")).action(async (options: CommonOptions) => {
  const paths = getDataPaths();
  const config = await readConfig(paths);
  const selectedAgents = Object.keys(config.integrations) as AgentId[];
  const adapters = createAdapters();
  const checks = [];
  for (const tool of toolIds) checks.push({ tool, checks: await adapters[tool].verify({ mode: "full", features: {} }, context(selectedAgents, true)) });
  const database = await TelemetryStore.open(paths); database.close();
  result({ checks, database: { status: "pass", path: paths.database } }, options);
});

addCommonOptions(program.command("collect").description("import available local metrics from enabled upstream tools")).action(async (options: CommonOptions) => {
  if (options.dryRun) return result({ dryRun: true, sources: ["rtk gain", "headroom perf", "caveman explicit stats file", "ponytail (unavailable)"] }, options);
  result(await collect(), options);
});

addCommonOptions(program.command("dashboard").description("collect metrics and start the local dashboard").option("--port <port>", "bind this local port").option("--no-open", "do not open the browser")).action(async (options: CommonOptions & { port?: string; open: boolean }) => {
  if (!options.dryRun) await collect();
  const staticDir = process.env.DONT_WASTE_DASHBOARD_ASSETS ?? path.resolve(process.cwd(), "apps/dashboard/dist");
  const dashboard = await createDashboardServer(getDataPaths(), { port: options.port ? Number(options.port) : undefined, staticDir: existsSync(staticDir) ? staticDir : undefined, host: process.env.DONT_WASTE_DASHBOARD_HOST });
  result({ url: dashboard.url, staticAssets: existsSync(staticDir) }, options);
  if (options.open) {
    const opener = process.platform === "win32" ? { command: "cmd", args: ["/c", "start", "", dashboard.url] } : process.platform === "darwin" ? { command: "open", args: [dashboard.url] } : { command: "xdg-open", args: [dashboard.url] };
    void execa(opener.command, opener.args, { reject: false, detached: true });
  }
  const close = async () => { await dashboard.close(); process.exit(0); };
  process.once("SIGINT", () => void close()); process.once("SIGTERM", () => void close());
});

addCommonOptions(program.command("update").description("check official upstream releases and apply an idempotent upgrade plan")).action(async (options: CommonOptions) => {
  const updates = await officialUpdates();
  if (!options.yes || options.dryRun) return result({ dontWaste: packageVersion, updates, next: "Review release notes; rerun with --yes to apply the validated integration plan." }, options);
  requireConfirmation(options);
  const config = await readConfig(getDataPaths());
  const setup = await makePlan({ ...options, profile: config.profile, channel: config.updateChannel });
  result({ updates, ...(await applyPlan(setup, "update", options)) }, options);
});

addCommonOptions(program.command("rollback <id>").description("restore the configuration snapshot from an operation")).action(async (id: string, options: CommonOptions) => {
  if (options.dryRun) return result({ dryRun: true, operation: id }, options);
  requireConfirmation(options);
  if (!options.yes && process.stdin.isTTY && !checked(await confirm({ message: `Restore snapshot ${id}?`, initialValue: false }))) return;
  const operation = await restoreOperation(getDataPaths(), id);
  result({ restored: id, operation }, options);
});

addCommonOptions(program.command("uninstall").description("remove Don’t Waste managed integrations without deleting upstream tools adopted from the user")).action(async (options: CommonOptions) => {
  if (options.dryRun) return result({ dryRun: true, action: "run adapter uninstallers and clear Don’t Waste integrations; telemetry stays local; use rollback <id> for a specific snapshot" }, options);
  requireConfirmation(options);
  if (!options.yes && process.stdin.isTTY && !checked(await confirm({ message: "Remove managed integrations and clear Don’t Waste activation state?", initialValue: false }))) return;
  const paths = getDataPaths();
  const config = await readConfig(paths);
  const selectedAgents = Object.keys(config.integrations) as AgentId[];
  const operation = await createOperation(paths, "uninstall", { selectedAgents }, [paths.config]);
  const adapterResults = await Promise.all(toolIds.map((tool) => createAdapters()[tool].uninstall(context(selectedAgents, false))));
  // Do not restore historical init/update snapshots: that can reapply later user edits
  // or undo the adapter uninstallers. Targeted recovery remains `dont-waste rollback <id>`.
  await writeConfig(paths, { ...config, integrations: {}, profile: "install-only" });
  await updateOperation(paths, operation.id, "succeeded");
  result({
    operation: operation.id,
    adapters: adapterResults,
    clearedIntegrations: selectedAgents,
    restoredSnapshots: [],
    telemetry: "preserved",
    note: "Historical snapshots were not auto-restored. Use dont-waste rollback <id> if you need a specific pre-init file state.",
  }, options);
});

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

export { collect, makePlan };
