import { describe, expect, it } from "vitest";
import {
  compareUpdates,
  compareVersions,
  normalizeVersion,
  toolsNeedingUpdate,
} from "../src/updates.js";

describe("update version comparison", () => {
  it("normalizes tags and CLI banners", () => {
    expect(normalizeVersion("v0.43.0")).toBe("0.43.0");
    expect(normalizeVersion("rtk 0.43.0")).toBe("0.43.0");
    expect(compareVersions("v0.43.0", "0.43.0")).toBe("equal");
    expect(compareVersions("0.42.0", "0.43.0")).toBe("different");
    expect(compareVersions(undefined, "0.43.0")).toBe("unknown");
  });

  it("classifies tools that need an upgrade plan", () => {
    const comparisons = compareUpdates(
      [
        { tool: "rtk", installed: "rtk 0.42.0", detected: true },
        { tool: "headroom", installed: "0.21.0", detected: true },
        { tool: "caveman", detected: false },
        { tool: "ponytail", installed: "1.0.0", detected: true },
      ],
      [
        { tool: "rtk", latest: "v0.43.0", url: "https://example.com/rtk" },
        {
          tool: "headroom",
          latest: "0.21.0",
          url: "https://example.com/headroom",
        },
        {
          tool: "caveman",
          latest: "v2.0.0",
          url: "https://example.com/caveman",
        },
        {
          tool: "ponytail",
          url: "https://example.com/ponytail",
          error: "rate limited",
        },
      ],
    );
    expect(comparisons.find((item) => item.tool === "rtk")?.status).toBe(
      "update-available",
    );
    expect(comparisons.find((item) => item.tool === "headroom")?.status).toBe(
      "up-to-date",
    );
    expect(comparisons.find((item) => item.tool === "caveman")?.status).toBe(
      "not-installed",
    );
    expect(comparisons.find((item) => item.tool === "ponytail")?.status).toBe(
      "error",
    );
    expect(toolsNeedingUpdate(comparisons)).toEqual(["rtk", "caveman"]);
    expect(
      toolsNeedingUpdate([
        {
          tool: "ponytail",
          installed: undefined,
          latest: "v4.8.4",
          url: "x",
          status: "unknown",
        },
      ]),
    ).toEqual([]);
  });
});
