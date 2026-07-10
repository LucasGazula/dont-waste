import { describe, expect, it } from "vitest";
import {
  cavemanStatsFixture,
  headroomBenchmarkFixture,
  headroomOutputSavingsFixture,
  headroomPerfFixture,
  privacyHostileFixture,
  rtkGainFixture,
} from "@dont-waste/test-fixtures";
import { importCavemanStats, importHeadroomJson, importRtkJson, sanitizeMetricRecord } from "../src/importers.js";

describe("upstream metric importers", () => {
  it("maps RTK token observations with project/agent/session/model/cost", () => {
    const events = importRtkJson(rtkGainFixture);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      tool: "rtk",
      tokensBefore: 1000,
      tokensAfter: 200,
      tokensSaved: 800,
      confidence: "measured",
      projectPath: "/work/demo",
      agentId: "codex",
      sessionId: "sess-rtk-1",
      model: "gpt-5",
      costBefore: 0.02,
      costAfter: 0.004,
      overlapKey: "rtk-flow-1",
    });
  });

  it("maps Headroom input compression as a measured input event", () => {
    expect(importHeadroomJson(headroomPerfFixture)[0]).toMatchObject({
      tool: "headroom",
      metricType: "input",
      tokensSaved: 200,
      confidence: "measured",
      agentId: "claude-code",
      sessionId: "sess-hr-1",
    });
  });

  it("treats Headroom output-savings as estimated unless measured/holdout", () => {
    const events = importHeadroomJson(headroomOutputSavingsFixture);
    expect(events[0]).toMatchObject({ metricType: "estimated-output", confidence: "estimated", tokensSaved: 300 });
    expect(events[1]).toMatchObject({ confidence: "measured", tokensSaved: 200 });
  });

  it("imports benchmark-reference as unavailable and non-measured", () => {
    const events = importHeadroomJson(headroomBenchmarkFixture);
    expect(events[0]).toMatchObject({
      metricType: "benchmark-reference",
      confidence: "unavailable",
      model: "benchmark-suite",
    });
  });

  it("parses explicit Caveman stats text as estimates only", () => {
    expect(importCavemanStats(cavemanStatsFixture)[0]).toMatchObject({
      tool: "caveman",
      confidence: "estimated",
      tokensSaved: 12400,
    });
  });

  it("strips prompts/outputs before import and never stores them in evidence", () => {
    const cleaned = sanitizeMetricRecord(JSON.parse(privacyHostileFixture).events[0]);
    expect(cleaned.prompt).toBeUndefined();
    expect(cleaned.output).toBeUndefined();
    expect(cleaned.conversation).toBeUndefined();
    const events = importRtkJson(privacyHostileFixture);
    expect(events[0]?.evidence).toBe("rtk:ls");
    expect(JSON.stringify(events)).not.toMatch(/SECRET/);
  });
});
