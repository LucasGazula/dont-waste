import { describe, expect, it } from "vitest";
import { headroomPerfFixture, rtkGainFixture } from "@dont-waste/test-fixtures";
import { importHeadroomJson, importRtkJson } from "../src/importers.js";

describe("upstream metric importers", () => {
  it("maps RTK's token observations into measured command-output events", () => {
    const events = importRtkJson(rtkGainFixture);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ tool: "rtk", tokensBefore: 1000, tokensAfter: 200, tokensSaved: 800, confidence: "measured" });
  });

  it("maps Headroom input compression as a measured input event", () => {
    expect(importHeadroomJson(headroomPerfFixture)[0]).toMatchObject({ tool: "headroom", metricType: "input", tokensSaved: 200, confidence: "measured" });
  });
});
