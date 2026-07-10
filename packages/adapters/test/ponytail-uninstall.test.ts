import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PonytailAdapter } from "../src/ponytail.js";

describe("ponytail uninstall", () => {
  it("plans host uninstall commands for supported agents", async () => {
    const adapter = new PonytailAdapter();
    const result = await adapter.uninstall({
      platform: "linux",
      home: await mkdtemp(path.join(os.tmpdir(), "dont-waste-ponytail-plan-")),
      selectedAgents: ["claude-code", "codex", "gemini-cli"],
      dryRun: true,
    });
    expect(
      result.skipped.map(
        (command) => `${command.command} ${command.args.join(" ")}`,
      ),
    ).toEqual(
      expect.arrayContaining([
        "claude plugin remove ponytail",
        "codex plugin remove ponytail",
        "gemini extensions uninstall ponytail",
      ]),
    );
  });

  it("removes OpenCode plugin entry and local config without host CLIs", async () => {
    const home = await mkdtemp(
      path.join(os.tmpdir(), "dont-waste-ponytail-un-"),
    );
    const opencode = path.join(home, ".config", "opencode", "opencode.json");
    await mkdir(path.dirname(opencode), { recursive: true });
    await writeFile(
      opencode,
      JSON.stringify({ plugin: ["keep", "@dietrichgebert/ponytail"] }, null, 2),
      "utf8",
    );
    await mkdir(path.join(home, ".config", "ponytail"), { recursive: true });
    await writeFile(
      path.join(home, ".config", "ponytail", "config.json"),
      JSON.stringify({ defaultMode: "full" }),
      "utf8",
    );

    const adapter = new PonytailAdapter();
    const result = await adapter.uninstall({
      platform: "linux",
      home,
      selectedAgents: ["opencode"],
      dryRun: false,
    });
    expect(result.succeeded).toBe(true);

    const config = JSON.parse(await readFile(opencode, "utf8")) as {
      plugin: string[];
    };
    expect(config.plugin).toEqual(["keep"]);
    await expect(
      readFile(path.join(home, ".config", "ponytail", "config.json"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
