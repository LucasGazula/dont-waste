import {
  capabilities,
  getCapability,
  type AgentId,
  type Capability,
  type ToolId,
} from "@dont-waste/catalog";
import { runCommand, commandHooksFromAdapterContext } from "./runtime.js";
import type {
  AdapterContext,
  Command,
  InstallResult,
  OperationPlan,
  ToolAdapter,
  ToolSelection,
} from "./types.js";

export abstract class BaseAdapter implements ToolAdapter {
  abstract readonly id: ToolId;
  abstract detect(context: AdapterContext): ReturnType<ToolAdapter["detect"]>;
  abstract planInstall(
    selection: ToolSelection,
    context: AdapterContext,
  ): ReturnType<ToolAdapter["planInstall"]>;
  abstract verify(
    selection: ToolSelection,
    context: AdapterContext,
  ): ReturnType<ToolAdapter["verify"]>;
  abstract collectMetrics(
    context: AdapterContext,
  ): ReturnType<ToolAdapter["collectMetrics"]>;
  abstract uninstallPaths(
    context: AdapterContext,
  ): ReturnType<ToolAdapter["uninstallPaths"]>;
  abstract uninstall(
    context: AdapterContext,
  ): ReturnType<ToolAdapter["uninstall"]>;

  getCapabilities(agent: AgentId): Capability[] {
    return capabilities.filter(
      (item) => item.tool === this.id && item.agent === agent,
    );
  }

  protected basePlan(
    selection: ToolSelection,
    context: AdapterContext,
    commands: Command[],
    warnings: string[] = [],
    affectedPaths: string[] = [],
  ): OperationPlan {
    return {
      tool: this.id,
      selection,
      commands,
      warnings,
      affectedPaths,
      capabilities: context.selectedAgents.map((agent) => ({
        agent,
        capability: getCapability(this.id, agent),
      })),
    };
  }

  async install(
    plan: OperationPlan,
    context: AdapterContext,
  ): Promise<InstallResult> {
    const executed: Command[] = [];
    const skipped: Command[] = [];
    const errors: string[] = [];
    for (const command of plan.commands) {
      const result = await runCommand(
        command,
        context.dryRun,
        commandHooksFromAdapterContext(context),
      );
      if (result.ran) executed.push(command);
      else skipped.push(command);
      if (result.error && !command.optional) {
        errors.push(result.error);
        break;
      }
    }
    return { succeeded: errors.length === 0, executed, skipped, errors };
  }
}
