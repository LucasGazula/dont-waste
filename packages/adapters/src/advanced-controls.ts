/**
 * Advanced control contracts for upstream tools.
 * Only `supported` entries may be wired into install/MCP/env paths.
 * Unsupported controls stay visible as pending notes — never invent flags.
 */
export type AdvancedControlStatus = "supported" | "unsupported";

export type AdvancedControlContract = {
  id: string;
  tool: "headroom" | "rtk" | "caveman" | "ponytail";
  status: AdvancedControlStatus;
  /** Feature key stored in ToolSelection.features when supported. */
  featureKey?: string;
  summary: string;
  /** Documented upstream surface (env, CLI, etc.). */
  upstream?: string;
  reason?: string;
};

/** Extended CCR cache TTL used when the ccrTtl feature is enabled (Headroom docs). */
export const HEADROOM_CCR_TTL_SECONDS_VALUE = "7200";

export const advancedControlContracts: readonly AdvancedControlContract[] = [
  {
    id: "headroom-ccr-ttl",
    tool: "headroom",
    status: "supported",
    featureKey: "ccrTtl",
    summary: "Extend Headroom CCR original-cache TTL for long agent runs",
    upstream: `HEADROOM_CCR_TTL_SECONDS=${HEADROOM_CCR_TTL_SECONDS_VALUE}`,
  },
  {
    id: "headroom-output-shaper",
    tool: "headroom",
    status: "supported",
    featureKey: "outputShaper",
    summary:
      "Enable Headroom output shaping (estimated savings without holdout)",
    upstream: "HEADROOM_OUTPUT_SHAPER=1",
  },
  {
    id: "headroom-learn-verbosity",
    tool: "headroom",
    status: "supported",
    featureKey: "learnVerbosity",
    summary: "Offer headroom learn --verbosity preview (never auto --apply)",
    upstream: "headroom learn --verbosity",
  },
  {
    id: "headroom-mcp-shrink",
    tool: "headroom",
    status: "unsupported",
    summary: "Discrete MCP-shrink toggle",
    reason:
      "No upstream flag named mcp-shrink; compression tools ship with `headroom mcp serve` once MCP is registered",
  },
  {
    id: "rtk-ultra-compact",
    tool: "rtk",
    status: "supported",
    featureKey: "ultraCompact",
    summary:
      "Advise RTK --ultra-compact for direct RTK commands (hooks stay command-aware)",
    upstream: "rtk --ultra-compact <command>",
  },
] as const;

export function supportedFeatureKeys(
  tool: AdvancedControlContract["tool"],
): string[] {
  return advancedControlContracts
    .filter(
      (item) =>
        item.tool === tool && item.status === "supported" && item.featureKey,
    )
    .map((item) => item.featureKey!);
}

export function unsupportedControls(
  tool?: AdvancedControlContract["tool"],
): AdvancedControlContract[] {
  return advancedControlContracts.filter(
    (item) => item.status === "unsupported" && (!tool || item.tool === tool),
  );
}

/** Env vars Don’t Waste may write into marker-owned Headroom MCP entries. */
export function headroomFeatureEnv(
  features: Record<string, boolean>,
): Record<string, string> | undefined {
  const env: Record<string, string> = {};
  if (features.outputShaper) env.HEADROOM_OUTPUT_SHAPER = "1";
  if (features.ccrTtl)
    env.HEADROOM_CCR_TTL_SECONDS = HEADROOM_CCR_TTL_SECONDS_VALUE;
  return Object.keys(env).length ? env : undefined;
}

export function pendingAdvancedControlNotes(
  tools: Array<AdvancedControlContract["tool"]> = ["headroom", "rtk"],
): string[] {
  const pending = advancedControlContracts.filter(
    (item) => item.status === "unsupported" && tools.includes(item.tool),
  );
  return pending.map(
    (item) =>
      `${item.id}: pending/unsupported — ${item.reason ?? item.summary}`,
  );
}
