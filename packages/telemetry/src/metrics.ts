import type { ToolId } from "@dont-waste/catalog";

export type MetricConfidence = "measured" | "estimated" | "unavailable";
export type MetricType =
  | "input"
  | "output"
  | "command-output"
  | "estimated-output"
  | "benchmark-reference";

export type MetricEvent = {
  id: string;
  occurredAt: string;
  tool: ToolId;
  metricType: MetricType;
  tokensBefore: number | null;
  tokensAfter: number | null;
  tokensSaved: number | null;
  confidence: MetricConfidence;
  sourceDepth: number;
  overlapKey?: string | undefined;
  projectPath?: string | undefined;
  agentId?: string | undefined;
  sessionId?: string | undefined;
  model?: string | undefined;
  evidence?: string | undefined;
  costBefore?: number | undefined;
  costAfter?: number | undefined;
};

export type MetricSummary = {
  before: number;
  after: number;
  measuredSaved: number;
  estimatedSaved: number;
  measuredPercent: number | null;
  eventCount: number;
  tools: Partial<
    Record<
      ToolId,
      { measuredSaved: number; estimatedSaved: number; events: number }
    >
  >;
};

function eventSavings(event: MetricEvent): number {
  if (event.tokensSaved !== null) return event.tokensSaved;
  if (event.tokensBefore !== null && event.tokensAfter !== null)
    return event.tokensBefore - event.tokensAfter;
  return 0;
}

/**
 * One content flow can be compacted by more than one layer. Only the earliest
 * observed transformation (the lowest sourceDepth) contributes to the measured
 * aggregate; later transformations remain visible in tool-level event views.
 */
export function selectNonOverlappingMeasured(
  events: MetricEvent[],
): MetricEvent[] {
  const independent: MetricEvent[] = [];
  const groups = new Map<string, MetricEvent[]>();
  for (const event of events) {
    if (event.confidence !== "measured") continue;
    if (!event.overlapKey) independent.push(event);
    else
      groups.set(event.overlapKey, [
        ...(groups.get(event.overlapKey) ?? []),
        event,
      ]);
  }
  for (const group of groups.values()) {
    group.sort(
      (left, right) =>
        left.sourceDepth - right.sourceDepth ||
        eventSavings(right) - eventSavings(left),
    );
    const first = group[0];
    if (first) independent.push(first);
  }
  return independent;
}

export function aggregateEvents(events: MetricEvent[]): MetricSummary {
  // Benchmark-reference events are informational and never enter measured/estimated totals.
  const countable = events.filter(
    (event) =>
      event.metricType !== "benchmark-reference" &&
      event.confidence !== "unavailable",
  );
  const selected = selectNonOverlappingMeasured(countable);
  const measuredSaved = selected.reduce(
    (total, event) => total + eventSavings(event),
    0,
  );
  const estimated = countable.filter(
    (event) => event.confidence === "estimated",
  );
  const estimatedSaved = estimated.reduce(
    (total, event) => total + eventSavings(event),
    0,
  );
  const before = selected.reduce(
    (total, event) => total + (event.tokensBefore ?? 0),
    0,
  );
  const after = selected.reduce(
    (total, event) => total + (event.tokensAfter ?? 0),
    0,
  );
  const tools: MetricSummary["tools"] = {};
  for (const event of countable) {
    const current = tools[event.tool] ?? {
      measuredSaved: 0,
      estimatedSaved: 0,
      events: 0,
    };
    current.events += 1;
    if (event.confidence === "estimated")
      current.estimatedSaved += eventSavings(event);
    if (selected.some((selectedEvent) => selectedEvent.id === event.id))
      current.measuredSaved += eventSavings(event);
    tools[event.tool] = current;
  }
  return {
    before,
    after,
    measuredSaved,
    estimatedSaved,
    measuredPercent: before > 0 ? (measuredSaved / before) * 100 : null,
    eventCount: selected.length,
    tools,
  };
}
