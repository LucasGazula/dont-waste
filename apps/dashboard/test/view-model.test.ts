import { describe, expect, it } from "vitest";
import { applyEventFilters } from "../src/view-model.js";

describe("dashboard view-model filters", () => {
  const events = [
    { id: "1", confidence: "measured", tool: "rtk", projectPath: "/repo/alpha", sessionId: "s1" },
    { id: "2", confidence: "estimated", tool: "caveman", projectPath: "/repo/beta", sessionId: "s2" },
    { id: "3", confidence: "unavailable", tool: "ponytail", sessionId: "s3" },
  ];

  it("supports measured/estimated/unavailable and tool/project/session filters", () => {
    expect(applyEventFilters(events, { confidence: "measured", tool: "all", project: "", session: "all" })).toHaveLength(1);
    expect(applyEventFilters(events, { confidence: "all", tool: "caveman", project: "", session: "all" }).map((e) => e.id)).toEqual(["2"]);
    expect(applyEventFilters(events, { confidence: "all", tool: "all", project: "alpha", session: "all" }).map((e) => e.id)).toEqual(["1"]);
    expect(applyEventFilters(events, { confidence: "all", tool: "all", project: "", session: "s3" }).map((e) => e.id)).toEqual(["3"]);
    expect(applyEventFilters(events, { confidence: "estimated", tool: "rtk", project: "", session: "all" })).toHaveLength(0);
  });
});
