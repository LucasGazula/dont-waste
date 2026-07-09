import { describe, expect, it } from "vitest";
import { aggregateEvents, type MetricEvent } from "../src/metrics.js";

const measured = (overrides: Partial<MetricEvent>): MetricEvent => ({
  id: crypto.randomUUID(),
  occurredAt: "2026-07-09T12:00:00.000Z",
  tool: "rtk",
  metricType: "command-output",
  tokensBefore: 1000,
  tokensAfter: 200,
  tokensSaved: 800,
  confidence: "measured",
  sourceDepth: 0,
  ...overrides,
});

describe("aggregateEvents", () => {
  it("counts measured events while keeping estimates out of the measured total", () => {
    const summary = aggregateEvents([
      measured({}),
      measured({ tool: "caveman", metricType: "estimated-output", confidence: "estimated", tokensBefore: 200, tokensAfter: 80, tokensSaved: 120 }),
    ]);

    expect(summary.measuredSaved).toBe(800);
    expect(summary.estimatedSaved).toBe(120);
    expect(summary.before).toBe(1000);
    expect(summary.after).toBe(200);
  });

  it("does not double count overlapping measured transformations", () => {
    const summary = aggregateEvents([
      measured({ id: "rtk", overlapKey: "shell-1", sourceDepth: 0, tokensSaved: 800 }),
      measured({ id: "headroom", tool: "headroom", overlapKey: "shell-1", sourceDepth: 1, tokensBefore: 200, tokensAfter: 100, tokensSaved: 100 }),
      measured({ id: "independent", overlapKey: "shell-2", tokensBefore: 500, tokensAfter: 100, tokensSaved: 400 }),
    ]);

    expect(summary.measuredSaved).toBe(1200);
    expect(summary.eventCount).toBe(2);
  });
});
