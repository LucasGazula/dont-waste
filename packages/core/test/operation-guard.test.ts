import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
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

  it("takes binary snapshots using base64 and restores them without corruption", async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "dw-guard-bin-"));
    tempDirs.push(dataDir);
    process.env.DONT_WASTE_DATA_DIR = dataDir;
    const paths = getDataPaths();

    // Create a mock binary file representing the rtk binary
    const binaryFile = path.join(dataDir, "rtk");
    const originalBinaryContent = Buffer.from([0, 1, 2, 3, 255, 128, 64]);
    await writeFile(binaryFile, originalBinaryContent);

    const operation = await createOperation(
      paths,
      "init",
      { profile: "custom" },
      [binaryFile],
    );

    // Mutate/corrupt the binary file
    await writeFile(binaryFile, Buffer.from("corrupted binary"));

    // Run rollback/fail operation which should restore it
    await failOperationAfterInterrupt(paths, operation.id, "failed test case");

    const restoredBinaryContent = await readFile(binaryFile);
    expect(restoredBinaryContent).toEqual(originalBinaryContent);
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

  it("handles SIGHUP interruption and performs rollback via real emission and verifies cleanup", async () => {
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

    const initialListeners = process.listenerCount("SIGHUP");
    let resolveWork: () => void = () => {};
    const workPromise = new Promise<void>((resolve) => {
      resolveWork = resolve;
    });

    const guardPromise = withOperationSignalGuards(
      paths,
      operation.id,
      async ({ signal }) => {
        expect(process.listenerCount("SIGHUP")).toBe(initialListeners + 1);
        signal.addEventListener("abort", () => {
          resolveWork();
        });
        // Emit real SIGHUP event on process
        process.emit("SIGHUP", "SIGHUP");
        await workPromise;
        if (signal.aborted) {
          throw new Error("interrupted");
        }
      },
      { exitOnSignal: false, settleTimeoutMs: 100 },
    );

    await guardPromise.catch(() => {});

    // Allow background rollback/updateOperation to completely settle
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(process.listenerCount("SIGHUP")).toBe(initialListeners);

    const ops = await listOperations(paths);
    const final = ops.find((item) => item.id === operation.id);
    expect(final?.status).toBe("failed");
    expect(final?.error).toMatch(/interrupted by SIGHUP/i);
  });
});
