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
  it("marks mcp-shrink unsupported and wires only documented Headroom env keys", () => {
    expect(
      unsupportedControls("headroom").some(
        (item) => item.id === "headroom-mcp-shrink",
      ),
    ).toBe(true);
    expect(
      advancedControlContracts.find((item) => item.id === "headroom-ccr-ttl")
        ?.status,
    ).toBe("supported");
    expect(headroomFeatureEnv({ outputShaper: true, ccrTtl: true })).toEqual({
      HEADROOM_OUTPUT_SHAPER: "1",
      HEADROOM_CCR_TTL_SECONDS: HEADROOM_CCR_TTL_SECONDS_VALUE,
    });
    expect(headroomFeatureEnv({})).toBeUndefined();
    expect(pendingAdvancedControlNotes(["headroom"])[0]).toContain(
      "mcp-shrink",
    );
  });

  it("embeds feature env into Headroom MCP specs", () => {
    const spec = headroomMcpSpec("/usr/bin/headroom", {
      outputShaper: true,
      ccrTtl: true,
    });
    expect(spec.env).toMatchObject({
      HEADROOM_OUTPUT_SHAPER: "1",
      HEADROOM_CCR_TTL_SECONDS: "7200",
    });
  });

  it("plans learn --verbosity as optional preview without --apply; install-only skips it", async () => {
    const adapter = new HeadroomAdapter();
    const withAgents = await adapter.planInstall(
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
    const learn = withAgents.commands.find((command) =>
      command.args.includes("--verbosity"),
    );
    expect(learn?.command).toBe("headroom");
    expect(learn?.args).toEqual(["learn", "--verbosity"]);
    expect(learn?.args).not.toContain("--apply");
    expect(learn?.optional).toBe(true);
    expect(learn?.interactive).toBe(true);
    expect(
      withAgents.warnings.some((warning) =>
        warning.includes("HEADROOM_CCR_TTL_SECONDS=7200"),
      ),
    ).toBe(true);
    expect(
      withAgents.warnings.some((warning) => warning.includes("mcp-shrink")),
    ).toBe(true);

    const installOnly = await adapter.planInstall(
      { mode: "full", features: { learnVerbosity: true } },
      { platform: "linux", home: "/tmp", selectedAgents: [], dryRun: true },
    );
    expect(
      installOnly.commands.some((command) =>
        command.args.includes("--verbosity"),
      ),
    ).toBe(false);
  });
});
