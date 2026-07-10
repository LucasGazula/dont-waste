import { mkdir, readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import {
  agentIds,
  modes,
  toolIds,
  type AgentId,
  type Mode,
  type ToolId,
} from "@dont-waste/catalog";
import type { DataPaths } from "./paths.js";

const integrationSchema = z.object({
  mode: z.enum(modes),
  enabled: z.boolean(),
  features: z.record(z.boolean()).default({}),
  installedAt: z.string().optional(),
  version: z.string().optional(),
});

export const configSchema = z.object({
  schemaVersion: z.literal(1),
  profile: z.enum(["balanced", "maximum-savings", "custom", "install-only"]),
  updateChannel: z.enum(["pinned", "latest"]),
  displayProjectPaths: z.boolean().default(false),
  integrations: z
    .record(
      z.enum(agentIds),
      z.record(z.enum(toolIds), integrationSchema).default({}),
    )
    .default({}),
  projects: z
    .array(z.object({ path: z.string(), alias: z.string().optional() }))
    .default([]),
});
export type DontWasteConfig = z.infer<typeof configSchema>;
export type IntegrationSettings = z.infer<typeof integrationSchema>;

export const defaultConfig = (): DontWasteConfig => ({
  schemaVersion: 1,
  profile: "balanced",
  updateChannel: "pinned",
  displayProjectPaths: false,
  integrations: {},
  projects: [],
});

export async function readConfig(paths: DataPaths): Promise<DontWasteConfig> {
  try {
    return configSchema.parse(JSON.parse(await readFile(paths.config, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return defaultConfig();
    throw new Error(
      `Invalid Don’t Waste config: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function writeConfig(
  paths: DataPaths,
  config: DontWasteConfig,
): Promise<void> {
  await mkdir(paths.root, { recursive: true });
  await writeFile(
    paths.config,
    `${JSON.stringify(configSchema.parse(config), null, 2)}\n`,
    "utf8",
  );
}

export function setIntegration(
  config: DontWasteConfig,
  agent: AgentId,
  tool: ToolId,
  mode: Mode,
  features: Record<string, boolean> = {},
): DontWasteConfig {
  const integrations = structuredClone(config.integrations);
  const byAgent = integrations[agent] ?? {};
  byAgent[tool] = {
    enabled: mode !== "off",
    mode,
    features,
    installedAt: new Date().toISOString(),
  };
  integrations[agent] = byAgent;
  return { ...config, integrations };
}
