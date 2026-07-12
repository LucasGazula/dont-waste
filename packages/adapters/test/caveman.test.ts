import {
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CavemanAdapter,
  cavemanOnlyId,
  resolveCavemanMode,
} from "../src/caveman.js";

describe("caveman adapter planning", () => {
  it("still installs Codex when another selected agent is already active", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "dont-waste-caveman-"));
    await mkdir(path.join(home, ".claude"), { recursive: true });
    await writeFile(
      path.join(home, ".claude", ".caveman-active"),
      "full\n",
      "utf8",
    );

    const plan = await new CavemanAdapter().planInstall(
      { mode: "full", features: {} },
      {
        platform: "linux",
        home,
        selectedAgents: ["codex", "claude-code"],
        dryRun: true,
      },
    );

    expect(plan.commands).toHaveLength(1);
    expect(plan.commands[0]?.args).toEqual(
      expect.arrayContaining(["--only", "codex"]),
    );
    expect(plan.commands[0]?.args).not.toEqual(
      expect.arrayContaining(["--only", "claude"]),
    );
    await rm(home, { recursive: true, force: true });
  });

  it("maps agents to official --only ids and persists selected mode", async () => {
    expect(cavemanOnlyId["claude-code"]).toBe("claude");
    expect(cavemanOnlyId.opencode).toBe("opencode");
    expect(resolveCavemanMode("ultra")).toBe("ultra");
    expect(resolveCavemanMode("wenyan")).toBe("wenyan");

    const home = await mkdtemp(path.join(os.tmpdir(), "dont-waste-caveman-"));
    const adapter = new CavemanAdapter();
    const context = {
      platform: "linux" as const,
      home,
      selectedAgents: [
        "claude-code" as const,
        "opencode" as const,
        "pi" as const,
      ],
      dryRun: true,
    };
    const selection = {
      mode: "ultra" as const,
      features: { statusline: false, cavecrew: true, compress: true },
    };
    const plan = await adapter.planInstall(selection, context);
    expect(plan.commands[0]?.command).toBe("npx");
    expect(plan.commands[0]?.args).toEqual(
      expect.arrayContaining([
        "--only",
        "claude",
        "--only",
        "opencode",
        "--non-interactive",
      ]),
    );
    expect(plan.commands[0]?.args).not.toContain("pi");
    expect(plan.warnings.some((item) => item.includes("pi"))).toBe(true);

    const live = {
      ...context,
      dryRun: false,
      selectedAgents: ["claude-code" as const, "opencode" as const],
    };
    const result = await adapter.install(
      { ...plan, selection, commands: [] },
      live,
    );
    expect(result.succeeded).toBe(true);
    expect(
      await readFile(path.join(home, ".claude", ".caveman-active"), "utf8"),
    ).toBe("ultra\n");
    expect(
      await readFile(
        path.join(home, ".config", "opencode", ".caveman-active"),
        "utf8",
      ),
    ).toBe("ultra\n");

    const configPath = path.join(home, ".config", "caveman", "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    expect(config.defaultMode).toBe("ultra");
    expect(config.cavecrew).toBe(true);
    expect(config.compress).toBe(true);
    expect(config["dont-waste-owned"]).toBe(true);

    const checks = await adapter.verify(selection, live);
    expect(
      checks.filter((check) => check.status === "pass").length,
    ).toBeGreaterThanOrEqual(5);

    // Test uninstall
    const uninstalled = await adapter.uninstall(live);
    expect(uninstalled.succeeded).toBe(true);
    // config.json should be removed since it was owned by don't waste
    await expect(readFile(configPath, "utf8")).rejects.toThrow();
    await rm(home, { recursive: true, force: true });
  });

  it("passes abortSignal to findExecutable in verify", async () => {
    const adapter = new CavemanAdapter();
    const controller = new AbortController();
    const checks = await adapter.verify(
      { mode: "full", features: {} },
      {
        platform: "linux",
        home: os.tmpdir(),
        selectedAgents: [],
        dryRun: true,
        abortSignal: controller.signal,
      },
    );
    expect(checks.find((c) => c.id === "caveman-node")).toBeDefined();
  });

  it("links the global Caveman skill into CODEX_HOME and verifies it", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "dont-waste-caveman-"));
    const codexHome = path.join(home, "codex-home");
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;
    try {
      const globalSkillDir = path.join(home, ".agents", "skills", "caveman");
      await mkdir(globalSkillDir, { recursive: true });
      await writeFile(
        path.join(globalSkillDir, "SKILL.md"),
        "---\nname: caveman\n---\n",
        "utf8",
      );
      const adapter = new CavemanAdapter();
      const context = {
        platform: "linux" as const,
        home,
        selectedAgents: ["codex" as const],
        dryRun: false,
      };
      const selection = { mode: "full" as const, features: {} };
      const plan = await adapter.planInstall(selection, context);
      const result = await adapter.install({ ...plan, commands: [] }, context);
      expect(result.succeeded).toBe(true);
      expect(await readlink(path.join(codexHome, "skills", "caveman"))).toBe(
        globalSkillDir,
      );

      const installed = await adapter.verify(selection, context);
      expect(
        installed.find((check) => check.id === "caveman-codex-skill"),
      ).toMatchObject({ status: "pass" });
    } finally {
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
      await rm(home, { recursive: true, force: true });
    }
  });

  it("symlinks global Caveman skill to antigravity-cli path and verifies it", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "dont-waste-caveman-"));
    const globalSkillDir = path.join(home, ".agents", "skills", "caveman");
    await mkdir(globalSkillDir, { recursive: true });
    await writeFile(
      path.join(globalSkillDir, "SKILL.md"),
      "---\nname: caveman\n---\n",
      "utf8",
    );

    const adapter = new CavemanAdapter();
    const context = {
      platform: "linux" as const,
      home,
      selectedAgents: ["antigravity-cli" as const],
      dryRun: false,
    };
    const selection = { mode: "full" as const, features: {} };
    const plan = await adapter.planInstall(selection, context);

    // Run install, which calls ensureSkillLinked (pass commands: [] to avoid executing external commands in tests)
    const result = await adapter.install({ ...plan, commands: [] }, context);
    expect(result.succeeded).toBe(true);
    expect(
      await readlink(
        path.join(home, ".gemini", "antigravity-cli", "skills", "caveman"),
      ),
    ).toBe(globalSkillDir);

    // Verify antigravity skill check passes
    const checks = await adapter.verify(selection, context);
    expect(
      checks.find((check) => check.id === "caveman-antigravity-skill"),
    ).toMatchObject({ status: "pass" });

    await rm(home, { recursive: true, force: true });
  });

  it("preserves an unowned Antigravity skill directory", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "dont-waste-caveman-"));
    const globalSkillDir = path.join(home, ".agents", "skills", "caveman");
    await mkdir(globalSkillDir, { recursive: true });
    await writeFile(
      path.join(globalSkillDir, "SKILL.md"),
      "---\nname: caveman\n---\n",
      "utf8",
    );

    const adapter = new CavemanAdapter();
    const context = {
      platform: "linux" as const,
      home,
      selectedAgents: ["antigravity-cli" as const],
      dryRun: false,
    };
    const selection = { mode: "full" as const, features: {} };
    const plan = await adapter.planInstall(selection, context);

    const targetDir = path.join(
      home,
      ".gemini",
      "antigravity-cli",
      "skills",
      "caveman",
    );
    await mkdir(targetDir, { recursive: true });
    await writeFile(
      path.join(targetDir, "SKILL.md"),
      "user-managed skill",
      "utf8",
    );

    const result = await adapter.install({ ...plan, commands: [] }, context);
    expect(result.succeeded).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "existing skill target is not a Don’t Waste link",
        ),
      ]),
    );
    expect(await readFile(path.join(targetDir, "SKILL.md"), "utf8")).toBe(
      "user-managed skill",
    );

    const checks = await adapter.verify(selection, context);
    expect(
      checks.find((check) => check.id === "caveman-antigravity-skill"),
    ).toMatchObject({ status: "fail" });

    await rm(home, { recursive: true, force: true });
  });

  it("rejects a wrong Codex skill symlink even when it contains SKILL.md", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "dont-waste-caveman-"));
    const codexHome = path.join(home, "codex-home");
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;
    try {
      const globalSkillDir = path.join(home, ".agents", "skills", "caveman");
      const wrongSkillDir = path.join(home, "wrong-caveman");
      await mkdir(globalSkillDir, { recursive: true });
      await mkdir(wrongSkillDir, { recursive: true });
      await writeFile(
        path.join(globalSkillDir, "SKILL.md"),
        "canonical",
        "utf8",
      );
      await writeFile(path.join(wrongSkillDir, "SKILL.md"), "stale", "utf8");
      const targetDir = path.join(codexHome, "skills", "caveman");
      await mkdir(path.dirname(targetDir), { recursive: true });
      await symlink(wrongSkillDir, targetDir, "dir");

      const adapter = new CavemanAdapter();
      const context = {
        platform: "linux" as const,
        home,
        selectedAgents: ["codex" as const],
        dryRun: false,
      };
      const selection = { mode: "full" as const, features: {} };
      const plan = await adapter.planInstall(selection, context);
      const result = await adapter.install({ ...plan, commands: [] }, context);

      expect(result.succeeded).toBe(false);
      expect(await readlink(targetDir)).toBe(wrongSkillDir);
      const checks = await adapter.verify(selection, context);
      expect(
        checks.find((check) => check.id === "caveman-codex-skill"),
      ).toMatchObject({ status: "fail" });
    } finally {
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
      await rm(home, { recursive: true, force: true });
    }
  });
});
