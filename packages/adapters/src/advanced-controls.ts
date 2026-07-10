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
    status: "unsupported",
    summary: "headroom learn --verbosity",
    upstream: "headroom learn --verbosity [--apply]",
    reason:
      "Privacy: Don’t Waste must not mine or apply session-transcript learning; leave learn --verbosity to the user outside this orchestrator",
  },
  {
    id: "headroom-mcp-shrink",
    tool: "headroom",
    status: "unsupported",
    summary: "Discrete MCP-shrink toggle/command",
    reason:
      "No verified upstream mcp-shrink flag/command; inventing one would not guarantee a Headroom executable on PATH nor a correct mcp.json/MCP registration",
  },
  {
    id: "rtk-temporal-ttl",
    tool: "rtk",
    status: "unsupported",
    summary: "Temporal TTL for RTK caches",
    reason:
      "RTK does not expose a temporal TTL comparable to HEADROOM_CCR_TTL_SECONDS; it uses size/LRU limits instead",
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
