import { describe, expect, it } from "vitest";
import {
  HEADROOM_CCR_TTL_SECONDS_VALUE,
  advancedControlContracts,
  headroomFeatureEnv,
  pendingAdvancedControlNotes,
  unsupportedControls,
} from "../src/advanced-controls.js";
import { headroomMcpSpec } from "../src/mcp.js";
import { HeadroomAdapter } from "../src/headroom.js";

describe("advanced control contracts", () => {
  it("supports only verified Headroom MCP env controls; keeps learn/mcp-shrink pending", () => {
    expect(
      advancedControlContracts.find((item) => item.id === "headroom-ccr-ttl")
        ?.status,
    ).toBe("supported");
    expect(
      advancedControlContracts.find(
        (item) => item.id === "headroom-output-shaper",
      )?.status,
    ).toBe("supported");
    expect(
      unsupportedControls("headroom")
        .map((item) => item.id)
        .sort(),
    ).toEqual(["headroom-learn-verbosity", "headroom-mcp-shrink"]);
    expect(
      unsupportedControls("rtk").some((item) => item.id === "rtk-temporal-ttl"),
    ).toBe(true);
    expect(headroomFeatureEnv({ outputShaper: true, ccrTtl: true })).toEqual({
      HEADROOM_OUTPUT_SHAPER: "1",
      HEADROOM_CCR_TTL_SECONDS: HEADROOM_CCR_TTL_SECONDS_VALUE,
    });
    expect(headroomFeatureEnv({ learnVerbosity: true })).toBeUndefined();
    const notes = pendingAdvancedControlNotes(["headroom", "rtk"]).join(" ");
    expect(notes).toContain("learn-verbosity");
    expect(notes).toContain("Privacy");
    expect(notes).toContain("mcp-shrink");
    expect(notes).toContain("size/LRU");
  });

  it("embeds only documented feature env into Headroom MCP specs", () => {
    const spec = headroomMcpSpec("/usr/bin/headroom", {
      outputShaper: true,
      ccrTtl: true,
      learnVerbosity: true,
    });
    expect(spec.env).toEqual({
      HEADROOM_OUTPUT_SHAPER: "1",
      HEADROOM_CCR_TTL_SECONDS: "7200",
    });
  });

  it("does not plan learn --verbosity; still warns about unsupported controls", async () => {
    const adapter = new HeadroomAdapter();
    const plan = await adapter.planInstall(
      {
        mode: "full",
        features: { learnVerbosity: true, ccrTtl: true, outputShaper: true },
      },
      {
        platform: "linux",
        home: "/tmp",
        selectedAgents: ["codex"],
        dryRun: true,
      },
    );
    expect(
      plan.commands.some((command) => command.args.includes("--verbosity")),
    ).toBe(false);
    expect(
      plan.warnings.some((warning) =>
        warning.includes("HEADROOM_CCR_TTL_SECONDS=7200"),
      ),
    ).toBe(true);
    expect(
      plan.warnings.some((warning) => warning.includes("mcp-shrink")),
    ).toBe(true);
    expect(
      plan.warnings.some((warning) => warning.includes("learn-verbosity")),
    ).toBe(true);
  });
});
