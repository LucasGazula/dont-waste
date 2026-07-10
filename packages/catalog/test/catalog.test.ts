import { describe, expect, it } from "vitest";
import { agentIds, capabilities, getCapability } from "../src/index.js";

describe("compatibility catalog", () => {
  it("declares every supported agent for every orchestrated tool", () => {
    expect(capabilities).toHaveLength(agentIds.length * 4);
    expect(getCapability("rtk", "codex")).toMatchObject({
      installMethod: "hook",
      supportsMetrics: "measured",
    });
    expect(getCapability("ponytail", "opencode")).toMatchObject({
      installMethod: "plugin",
      supportsMetrics: "unavailable",
    });
  });
});
