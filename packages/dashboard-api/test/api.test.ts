import { describe, expect, it } from "vitest";
import { defaultConfig } from "@dont-waste/core";
import { dashboardOverview } from "../src/overview.js";

describe("dashboard API", () => {
  it("returns a measured total while keeping estimates separate", () => {
    const overview = dashboardOverview(defaultConfig(), [
      {
        id: "measured",
        occurredAt: "2026-07-09T00:00:00Z",
        tool: "rtk",
        metricType: "command-output",
        tokensBefore: 100,
        tokensAfter: 20,
        tokensSaved: 80,
        confidence: "measured",
        sourceDepth: 0,
      },
      {
        id: "estimated",
        occurredAt: "2026-07-09T00:00:00Z",
        tool: "caveman",
        metricType: "estimated-output",
        tokensBefore: 50,
        tokensAfter: 10,
        tokensSaved: 40,
        confidence: "estimated",
        sourceDepth: 0,
      },
    ]);
    expect(overview.summary).toMatchObject({
      measuredSaved: 80,
      estimatedSaved: 40,
    });
  });
});
