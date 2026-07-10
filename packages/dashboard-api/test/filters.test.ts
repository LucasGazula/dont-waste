import { describe, expect, it } from "vitest";
import { aggregateDaily, aggregateWeekly } from "../src/aggregation.js";
import { costTotals, filterEvents, overlapGroups } from "../src/filters.js";
import { dashboardOverview } from "../src/overview.js";
import { defaultConfig } from "@dont-waste/core";
import type { MetricEvent } from "@dont-waste/telemetry";

const sample: MetricEvent[] = [
  {
    id: "m1",
    occurredAt: "2026-07-06T10:00:00Z",
    tool: "rtk",
    metricType: "command-output",
    tokensBefore: 100,
    tokensAfter: 20,
    tokensSaved: 80,
    confidence: "measured",
    sourceDepth: 0,
    overlapKey: "flow-a",
    projectPath: "/tmp/a",
    sessionId: "s1",
    costBefore: 0.02,
    costAfter: 0.01,
  },
  {
    id: "m2",
    occurredAt: "2026-07-06T11:00:00Z",
    tool: "headroom",
    metricType: "context",
    tokensBefore: 50,
    tokensAfter: 40,
    tokensSaved: 10,
    confidence: "measured",
    sourceDepth: 1,
    overlapKey: "flow-a",
    projectPath: "/tmp/a",
    sessionId: "s1",
  },
  {
    id: "e1",
    occurredAt: "2026-07-08T10:00:00Z",
    tool: "caveman",
    metricType: "estimated-output",
    tokensBefore: 40,
    tokensAfter: 10,
    tokensSaved: 30,
    confidence: "estimated",
    sourceDepth: 0,
    projectPath: "/tmp/b",
    sessionId: "s2",
  },
  {
    id: "u1",
    occurredAt: "2026-07-08T12:00:00Z",
    tool: "ponytail",
    metricType: "output",
    tokensBefore: null,
    tokensAfter: null,
    tokensSaved: null,
    confidence: "unavailable",
    sourceDepth: 0,
  },
];

describe("aggregation", () => {
  it("buckets measured and estimated savings by day and ISO week", () => {
    expect(aggregateDaily(sample)).toEqual([
      { day: "2026-07-06", measuredSaved: 90, estimatedSaved: 0, events: 2 },
      { day: "2026-07-08", measuredSaved: 0, estimatedSaved: 30, events: 2 },
    ]);
    const weeks = aggregateWeekly(sample);
    expect(weeks).toHaveLength(1);
    expect(weeks[0]?.week).toMatch(/^2026-W\d{2}$/);
    expect(weeks[0]?.measuredSaved).toBe(90);
    expect(weeks[0]?.estimatedSaved).toBe(30);
  });
});

describe("event filters", () => {
  it("filters by confidence, tool, project fragment, and session", () => {
    expect(filterEvents(sample, { confidence: "measured" })).toHaveLength(2);
    expect(filterEvents(sample, { tool: "caveman" }).map((e) => e.id)).toEqual([
      "e1",
    ]);
    expect(
      filterEvents(sample, { project: "/tmp/b" }).map((e) => e.id),
    ).toEqual(["e1"]);
    expect(filterEvents(sample, { session: "s1" })).toHaveLength(2);
    expect(
      filterEvents(sample, { confidence: "unavailable", tool: "ponytail" }),
    ).toHaveLength(1);
  });

  it("reports overlap groups and cost totals", () => {
    expect(overlapGroups(sample)).toEqual([
      { overlapKey: "flow-a", tools: ["rtk", "headroom"], depths: [0, 1] },
    ]);
    expect(costTotals(sample)).toEqual({
      costBefore: 0.02,
      costAfter: 0.01,
      saved: 0.01,
    });
  });
});

describe("dashboard overview contract", () => {
  it("exposes daily/weekly/costs/privacy/sessions without raw dumps", () => {
    const overview = dashboardOverview(defaultConfig(), sample, {
      projects: [{ path: "/tmp/a", alias: "Alpha" }],
      sessions: [{ id: "s1", agent: "codex", projectPath: "/tmp/a" }],
    });
    expect(overview.daily).toHaveLength(2);
    expect(overview.weekly).toHaveLength(1);
    expect(overview.costs.saved).toBeCloseTo(0.01);
    expect(overview.privacy).toMatchObject({
      storesPrompts: false,
      storesOutputs: false,
    });
    expect(overview.overlaps[0]?.overlapKey).toBe("flow-a");
    expect(overview.sessions).toHaveLength(1);
    expect(overview).not.toHaveProperty("raw");
  });
});
