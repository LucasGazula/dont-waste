import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createOperation,
  getDataPaths,
  listOperations,
  trackInFlight,
  updateOperation,
  waitForInFlight,
  withOperationSignalGuards,
} from "@dont-waste/core";
import { RtkAdapter, RTK_RELEASE_LABEL } from "../src/rtk.js";
import { installRtkFromOfficialRelease } from "../src/rtk-release.js";
import {
  DEFAULT_FORCE_KILL_MS,
  FIND_EXECUTABLE_TIMEOUT_MS,
  runCommand,
} from "../src/runtime.js";

const tempDirs: string[] = [];
const previousDataDir = process.env.DONT_WASTE_DATA_DIR;

afterEach(async () => {
  if (previousDataDir === undefined) delete process.env.DONT_WASTE_DATA_DIR;
  else process.env.DONT_WASTE_DATA_DIR = previousDataDir;
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("cancel before rollback", () => {
  it("aborts the child and settles in-flight work before marking failed", async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "dw-abort-"));
    tempDirs.push(dataDir);
    process.env.DONT_WASTE_DATA_DIR = dataDir;
    const paths = getDataPaths();
    const marker = path.join(dataDir, "marker.txt");
    await writeFile(marker, "before\n");
    const operation = await createOperation(
      paths,
      "init",
      { profile: "custom" },
      [marker],
    );
    await updateOperation(paths, operation.id, "running");

    const order: string[] = [];
    const started = Date.now();
    await withOperationSignalGuards(
      paths,
      operation.id,
      async ({ signal, interrupt }) => {
        const child = runCommand(
          {
            command: process.execPath,
            args: ["-e", "setTimeout(() => {}, 60_000)"],
            label: "hang child",
            timeoutMs: 30_000,
            forceKillAfterDelay: 200,
          },
          false,
          { abortSignal: signal },
        );
        void child.then(() => order.push("child-settled"));
        await interrupt("SIGINT");
        order.push("after-interrupt");
        await child;
      },
      { exitOnSignal: false, settleTimeoutMs: 3_000 },
    ).catch(() => undefined);

    expect(Date.now() - started).toBeLessThan(10_000);
    expect(order).toContain("after-interrupt");
    const final = (await listOperations(paths)).find(
      (item) => item.id === operation.id,
    );
    expect(final?.status).toBe("failed");
    expect(final?.error).toMatch(/SIGINT/);
  }, 20_000);

  it("waitForInFlight resolves tracked promises before continuing", async () => {
    let done = false;
    const pending = new Promise<void>((resolve) => {
      setTimeout(() => {
        done = true;
        resolve();
      }, 50);
    });
    void trackInFlight(pending);
    await waitForInFlight(2_000);
    expect(done).toBe(true);
  });
});

describe("guarded uninstall failure", () => {
  it("marks uninstall failed after unexpected throw without leaving running", async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "dw-un-"));
    tempDirs.push(dataDir);
    process.env.DONT_WASTE_DATA_DIR = dataDir;
    const paths = getDataPaths();
    const configPath = path.join(dataDir, "config.json");
    await writeFile(configPath, "{}\n");
    const operation = await createOperation(
      paths,
      "uninstall",
      { profile: "custom" },
      [configPath],
    );
    await updateOperation(paths, operation.id, "running");

    await expect(
      withOperationSignalGuards(
        paths,
        operation.id,
        async () => {
          throw new Error("adapter boom");
        },
        { exitOnSignal: false },
      ),
    ).rejects.toThrow(/adapter boom/);

    const final = (await listOperations(paths)).find(
      (item) => item.id === operation.id,
    );
    expect(final?.status).toBe("failed");
    expect(final?.error).toMatch(/adapter boom/);
  });
});

describe("RTK release progress hook", () => {
  it("invokes beforeCommand before the official-release install branch", async () => {
    const adapter = new RtkAdapter();
    const seen: string[] = [];
    const releaseCommand = {
      command: "dont-waste-internal",
      args: ["rtk-release-install", "fake"],
      label: RTK_RELEASE_LABEL,
    };

    const result = await adapter.install(
      {
        tool: "rtk",
        selection: { mode: "full", features: {} },
        commands: [releaseCommand],
        warnings: [],
        affectedPaths: [],
        capabilities: [],
      },
      {
        platform: process.platform,
        home: os.tmpdir(),
        selectedAgents: ["codex"],
        dryRun: true,
        beforeCommand: async (command) => {
          seen.push(command.label);
        },
      },
    );

    expect(seen).toEqual([RTK_RELEASE_LABEL]);
    expect(result.skipped.map((item) => item.label)).toContain(
      RTK_RELEASE_LABEL,
    );
    expect(result.succeeded).toBe(true);
  });
});

describe("RTK release abort race", () => {
  it("aborts a hanging official-release fetch before any extract mutation", async () => {
    const controller = new AbortController();
    const installDir = await mkdtemp(path.join(os.tmpdir(), "dw-rtk-race-"));
    tempDirs.push(installDir);
    let extractAttempted = false;
    const hung = installRtkFromOfficialRelease({
      platform: "linux",
      arch: "x64",
      tag: "v0.0.0-test",
      installDir,
      abortSignal: controller.signal,
      fetchImpl: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        return await new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          const fail = () => {
            extractAttempted = true;
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          };
          if (signal?.aborted) {
            fail();
            return;
          }
          signal?.addEventListener("abort", fail, { once: true });
        });
      }) as typeof fetch,
    });
    setTimeout(() => controller.abort(), 10);
    await expect(hung).rejects.toThrow(/Aborted|abort/i);
    expect(extractAttempted).toBe(true);
  });
});

describe("helper timeout/force-kill settings", () => {
  it("exports bounded findExecutable timeout and default force-kill", () => {
    expect(FIND_EXECUTABLE_TIMEOUT_MS).toBe(3_000);
    expect(DEFAULT_FORCE_KILL_MS).toBe(5_000);
  });

  it("keeps RTK init env/timeout for every selected agent in custom plans", async () => {
    const adapter = new RtkAdapter();
    const home = await mkdtemp(path.join(os.tmpdir(), "dw-rtk-h-"));
    tempDirs.push(home);
    const plan = await adapter.planInstall(
      { mode: "full", features: {} },
      {
        platform: "linux",
        home,
        dryRun: true,
        selectedAgents: ["codex", "claude-code", "pi"],
      },
    );
    const inits = plan.commands.filter((command) =>
      command.args.includes("init"),
    );
    expect(inits).toHaveLength(3);
    for (const command of inits) {
      expect(command.env?.RTK_TELEMETRY_DISABLED).toBe("1");
      expect(command.timeoutMs).toBe(120_000);
      expect(command.forceKillAfterDelay).toBe(5_000);
    }
  });
});
