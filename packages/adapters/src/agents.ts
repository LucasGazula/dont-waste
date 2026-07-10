import { access } from "node:fs/promises";
import path from "node:path";
import {
  agents,
  type AgentDefinition,
  type AgentId,
} from "@dont-waste/catalog";
import { expandHome } from "@dont-waste/core";
import { executableDetection } from "./runtime.js";
import type { AdapterContext, DetectionResult } from "./types.js";

export type AgentDetection = DetectionResult & {
  agent: AgentId;
  configPaths: string[];
  existingConfigs: string[];
};

function pathsFor(
  definition: AgentDefinition,
  context: Pick<AdapterContext, "platform" | "home">,
): string[] {
  const group =
    context.platform === "win32"
      ? "win32"
      : context.platform === "darwin"
        ? "darwin"
        : "linux";
  return definition.configPaths[group].map((item) =>
    expandHome(item, context.home),
  );
}

export async function detectAgents(
  context: Pick<AdapterContext, "platform" | "home">,
): Promise<AgentDetection[]> {
  return Promise.all(
    agents.map(async (agent) => {
      const detection = await executableDetection(agent.id, agent.executable);
      const configPaths = pathsFor(agent, context);
      const existingConfigs = (
        await Promise.all(
          configPaths.map(async (config) => {
            try {
              await access(config);
              return config;
            } catch {
              return undefined;
            }
          }),
        )
      ).filter((file): file is string => Boolean(file));
      return { ...detection, agent: agent.id, configPaths, existingConfigs };
    }),
  );
}

export function getAgentPaths(
  agent: AgentId,
  context: Pick<AdapterContext, "platform" | "home">,
): string[] {
  const definition = agents.find((item) => item.id === agent);
  if (!definition) throw new Error(`Unknown agent ${agent}`);
  return pathsFor(definition, context);
}

export function ponytailConfigPath(
  context: Pick<AdapterContext, "platform" | "home">,
): string {
  return context.platform === "win32"
    ? path.join(
        process.env.APPDATA ?? path.join(context.home, "AppData", "Roaming"),
        "ponytail",
        "config.json",
      )
    : path.join(context.home, ".config", "ponytail", "config.json");
}
