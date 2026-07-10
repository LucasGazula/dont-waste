import type { DontWasteConfig } from "@dont-waste/core";
import type { AgentId, ToolId } from "@dont-waste/catalog";
import type { ToolSelection } from "./types.js";

export type ConfiguredTool = {
  tool: ToolId;
  selection: ToolSelection;
  agents: AgentId[];
};

/** Resolve enabled tool selections from saved Don’t Waste config for doctor/health. */
export function configuredToolsFromConfig(
  config: DontWasteConfig,
): ConfiguredTool[] {
  const byTool = new Map<ToolId, ConfiguredTool>();
  for (const [agent, tools] of Object.entries(config.integrations) as Array<
    [AgentId, DontWasteConfig["integrations"][AgentId]]
  >) {
    if (!tools) continue;
    for (const [tool, settings] of Object.entries(tools) as Array<
      [
        ToolId,
        {
          mode: ToolSelection["mode"];
          enabled: boolean;
          features: Record<string, boolean>;
        },
      ]
    >) {
      if (!settings?.enabled || settings.mode === "off") continue;
      const current = byTool.get(tool);
      if (current) {
        current.agents.push(agent);
        continue;
      }
      byTool.set(tool, {
        tool,
        selection: { mode: settings.mode, features: settings.features ?? {} },
        agents: [agent],
      });
    }
  }
  return [...byTool.values()];
}
