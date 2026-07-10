import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  headroomMcpSpec,
  registerHeadroomMcp,
  readMcpServer,
} from "../src/mcp.js";

describe("headroom MCP feature env", () => {
  it("round-trips CCR/output-shaper env through marker-owned Codex config", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "dont-waste-mcp-env-"));
    const spec = headroomMcpSpec("/usr/local/bin/headroom", {
      outputShaper: true,
      ccrTtl: true,
    });
    const result = await registerHeadroomMcp("codex", spec, {
      home,
      platform: "linux",
    });
    expect(result.status).toBe("registered");
    const content = await readFile(result.path!, "utf8");
    expect(content).toContain("[mcp_servers.headroom.env]");
    expect(content).toContain('HEADROOM_OUTPUT_SHAPER = "1"');
    expect(content).toContain('HEADROOM_CCR_TTL_SECONDS = "7200"');
    const read = await readMcpServer(
      "codex",
      { home, platform: "linux" },
      "headroom",
    );
    expect(read?.env).toEqual(spec.env);
  });
});
