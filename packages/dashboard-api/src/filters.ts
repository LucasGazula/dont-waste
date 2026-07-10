import type { MetricEvent } from "@dont-waste/telemetry";

export type EventFilters = {
  confidence?: "measured" | "estimated" | "unavailable" | "all" | undefined;
  tool?: string | undefined;
  project?: string | undefined;
  session?: string | undefined;
};

/** Pure filter used by /api/events and covered by unit tests (Playwright not available). */
export function filterEvents(
  events: MetricEvent[],
  filters: EventFilters = {},
): MetricEvent[] {
  return events.filter((event) => {
    if (
      filters.confidence &&
      filters.confidence !== "all" &&
      event.confidence !== filters.confidence
    )
      return false;
    if (filters.tool && event.tool !== filters.tool) return false;
    if (filters.project) {
      const project = event.projectPath ?? "";
      if (!project.includes(filters.project)) return false;
    }
    if (filters.session && event.sessionId !== filters.session) return false;
    return true;
  });
}

/** Overlap groups that contribute to de-duplication messaging in the UI. */
export function overlapGroups(
  events: MetricEvent[],
): Array<{ overlapKey: string; tools: string[]; depths: number[] }> {
  const groups = new Map<string, MetricEvent[]>();
  for (const event of events) {
    if (!event.overlapKey || event.confidence !== "measured") continue;
    groups.set(event.overlapKey, [
      ...(groups.get(event.overlapKey) ?? []),
      event,
    ]);
  }
  return [...groups.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([overlapKey, items]) => ({
      overlapKey,
      tools: [...new Set(items.map((item) => item.tool))],
      depths: items.map((item) => item.sourceDepth).sort((a, b) => a - b),
    }));
}

export function costTotals(events: MetricEvent[]): {
  costBefore: number;
  costAfter: number;
  saved: number;
} {
  let costBefore = 0;
  let costAfter = 0;
  for (const event of events) {
    if (typeof event.costBefore === "number") costBefore += event.costBefore;
    if (typeof event.costAfter === "number") costAfter += event.costAfter;
  }
  return { costBefore, costAfter, saved: costBefore - costAfter };
}
