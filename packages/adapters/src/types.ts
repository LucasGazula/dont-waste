import type { AgentId, Capability, Mode, ToolId } from "@dont-waste/catalog";
import type { MetricEvent } from "@dont-waste/telemetry";

export type Command = {
  command: string;
  args: string[];
  label: string;
  interactive?: boolean | undefined;
  /** Optional commands may fail without aborting the operation; optional interactive commands also do not block activation. */
  optional?: boolean | undefined;

  shell?: boolean | undefined;
  /** Extra env for this child only (merged over process.env). */
  env?: Record<string, string> | undefined;
  /** Kill the child after this many ms (default applied in runCommand). */
  timeoutMs?: number | undefined;
  /** execa forceKillAfterDelay; default 5000 when timeout is set. */
  forceKillAfterDelay?: number | false | undefined;
};

export type RunCommandHooks = {
  /** Called before skip/spawn so the CLI can stop a spinner and show progress. */
  beforeCommand?: ((command: Command) => void | Promise<void>) | undefined;
  /** Abort in-flight execa children (SIGINT/SIGTERM / tests). */
  abortSignal?: AbortSignal | undefined;
};

export type DetectionResult = {
  id: string;
  detected: boolean;
  version?: string | undefined;
  path?: string | undefined;
  warnings: string[];
};

export type HealthCheck = {
  id: string;
  status: "pass" | "warn" | "fail";
  message: string;
  remediation?: string | undefined;
};

export type AdapterContext = {
  platform: NodeJS.Platform;
  home: string;
  selectedAgents: AgentId[];
  dryRun: boolean;
  /** Stop UI spinners / print progress before each planned command. */
  beforeCommand?: ((command: Command) => void | Promise<void>) | undefined;
  /** Cancel external children when the operation is interrupted. */
  abortSignal?: AbortSignal | undefined;
};

export type ToolSelection = { mode: Mode; features: Record<string, boolean> };

export type OperationPlan = {
  tool: ToolId;
  selection: ToolSelection;
  commands: Command[];
  affectedPaths: string[];
  warnings: string[];
  capabilities: Array<{ agent: AgentId; capability: Capability }>;
};

export type InstallResult = {
  succeeded: boolean;
  executed: Command[];
  skipped: Command[];
  errors: string[];
};
export type MetricImportResult = {
  source: string;
  events: MetricEvent[];
  error?: string | undefined;
};

export interface ToolAdapter {
  readonly id: ToolId;
  detect(context: AdapterContext): Promise<DetectionResult>;
  getCapabilities(agent: AgentId): Capability[];
  planInstall(
    selection: ToolSelection,
    context: AdapterContext,
  ): Promise<OperationPlan>;
  install(plan: OperationPlan, context: AdapterContext): Promise<InstallResult>;
  verify(
    selection: ToolSelection,
    context: AdapterContext,
  ): Promise<HealthCheck[]>;
  collectMetrics(context: AdapterContext): Promise<MetricImportResult>;
  /** Paths this uninstall may change; used to snapshot before mutation. */
  uninstallPaths(context: AdapterContext): Promise<string[]>;
  uninstall(context: AdapterContext): Promise<InstallResult>;
}
