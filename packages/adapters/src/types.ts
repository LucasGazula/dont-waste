import type { AgentId, Capability, Mode, ToolId } from "@dont-waste/catalog";
import type { MetricEvent } from "@dont-waste/telemetry";

export type Command = {
  command: string;
  args: string[];
  label: string;
  interactive?: boolean | undefined;
  /** Interactive/skipped commands with optional=true do not block integration activation. */
  optional?: boolean | undefined;
  shell?: boolean | undefined;
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
