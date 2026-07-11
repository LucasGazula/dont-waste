import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createOperation,
  failOperationAfterInterrupt,
  getDataPaths,
  listOperations,
  trackInFlight,
  updateOperation,
  waitForInFlight,
  withOperationSignalGuards,
} from "../src/index.js";

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

describe("operation signal guard", () => {
  it("marks interrupted running operations failed after rollback", async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "dw-op-"));
    tempDirs.push(dataDir);
    process.env.DONT_WASTE_DATA_DIR = dataDir;
    const paths = getDataPaths();
    const configPath = path.join(dataDir, "config.json");
    const operation = await createOperation(
      paths,
      "init",
      { profile: "custom", agents: ["codex", "claude-code"] },
      [configPath],
    );
    await updateOperation(paths, operation.id, "running");

    await failOperationAfterInterrupt(
      paths,
      operation.id,
      "interrupted by SIGINT",
    );

    const ops = await listOperations(paths);
    const final = ops.find((item) => item.id === operation.id);
    expect(final?.status).toBe("failed");
    expect(final?.error).toMatch(/SIGINT|interrupted/i);
  });

  it("withOperationSignalGuards rolls back when the work throws", async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "dw-guard-"));
    tempDirs.push(dataDir);
    process.env.DONT_WASTE_DATA_DIR = dataDir;
    const paths = getDataPaths();
    const marker = path.join(dataDir, "marker.txt");
    const operation = await createOperation(
      paths,
      "init",
      { profile: "custom" },
      [marker],
    );
    await updateOperation(paths, operation.id, "running");

    await expect(
      withOperationSignalGuards(
        paths,
        operation.id,
        async () => {
          throw new Error("child hung");
        },
        { exitOnSignal: false },
      ),
    ).rejects.toThrow(/child hung/);

    const ops = await listOperations(paths);
    const final = ops.find((item) => item.id === operation.id);
    expect(final?.status).toBe("failed");
    expect(final?.error).toMatch(/child hung/);
  });

  it("waitForInFlight clears its settle timer after racing", async () => {
    const pending = new Promise<void>((resolve) => setTimeout(resolve, 20));
    void trackInFlight(pending);
    await waitForInFlight(5_000);
    await pending;
    // Empty set + cleared timer: second wait returns immediately.
    const started = Date.now();
    await waitForInFlight(5_000);
    expect(Date.now() - started).toBeLessThan(100);
  });

  it("signal interrupt rollback errors stay best-effort (no unhandled rejection) and mark failed", async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "dw-guard-be-"));
    tempDirs.push(dataDir);
    process.env.DONT_WASTE_DATA_DIR = dataDir;
    const paths = getDataPaths();
    const operation = await createOperation(
      paths,
      "init",
      { profile: "custom" },
      [path.join(dataDir, "missing-snapshot-target")],
    );
    await updateOperation(paths, operation.id, "running");
    await rm(operation.snapshotFile);

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      await withOperationSignalGuards(
        paths,
        operation.id,
        async ({ interrupt }) => {
          await interrupt("SIGINT");
        },
        { exitOnSignal: false },
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(unhandled).toEqual([]);

      const ops = await listOperations(paths);
      const final = ops.find((item) => item.id === operation.id);
      expect(final?.status).toBe("failed");
      expect(final?.error).toMatch(/interrupted by SIGINT/i);
      expect(final?.error).toMatch(/Rollback failed/i);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("handles SIGHUP interruption and performs rollback", async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "dw-guard-hup-"));
    tempDirs.push(dataDir);
    process.env.DONT_WASTE_DATA_DIR = dataDir;
    const paths = getDataPaths();
    const operation = await createOperation(
      paths,
      "init",
      { profile: "custom" },
      [],
    );
    await updateOperation(paths, operation.id, "running");

    await withOperationSignalGuards(
      paths,
      operation.id,
      async ({ interrupt }) => {
        await interrupt("SIGHUP");
      },
      { exitOnSignal: false },
    );

    const ops = await listOperations(paths);
    const final = ops.find((item) => item.id === operation.id);
    expect(final?.status).toBe("failed");
    expect(final?.error).toMatch(/interrupted by SIGHUP/i);
  });
});
