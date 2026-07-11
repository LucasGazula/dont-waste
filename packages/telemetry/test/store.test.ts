import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getDataPaths } from "@dont-waste/core";
import { importHeadroomJson, importRtkJson } from "../src/importers.js";
import { aggregateEvents } from "../src/metrics.js";
import { TelemetryStore } from "../src/database.js";
import {
  headroomBenchmarkFixture,
  headroomPerfFixture,
  rtkGainFixture,
} from "@dont-waste/test-fixtures";

const previous = process.env.DONT_WASTE_DATA_DIR;

afterEach(() => {
  if (previous === undefined) delete process.env.DONT_WASTE_DATA_DIR;
  else process.env.DONT_WASTE_DATA_DIR = previous;
});

describe("telemetry projects sessions and cursors", () => {
  it("upserts projects/sessions from imported events and records import cursors", async () => {
    const dataDir = await mkdtemp(
      path.join(os.tmpdir(), "dont-waste-telemetry-"),
    );
    process.env.DONT_WASTE_DATA_DIR = dataDir;
    const store = await TelemetryStore.open(getDataPaths());
    store.upsertProject("/work/demo", "Demo");
    const events = [
      ...importRtkJson(rtkGainFixture),
      ...importHeadroomJson(headroomPerfFixture),
    ];
    const inserted = store.insertEvents(events);
    expect(inserted).toBeGreaterThan(0);
    expect(store.listProjects()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/work/demo", alias: "Demo" }),
      ]),
    );
    expect(
      store
        .listSessions()
        .some(
          (session) => session.id === "sess-rtk-1" && session.agent === "codex",
        ),
    ).toBe(true);
    const cursor = events
      .map((event) => event.occurredAt)
      .sort()
      .at(-1)!;
    store.recordImport("rtk gain", inserted, undefined, cursor);
    expect(store.latestImportCursor("rtk gain")).toBe(cursor);
    expect(store.recentImports()[0]).toMatchObject({
      source: "rtk gain",
      cursor,
      error: null,
    });
    store.close();
  });

  it("keeps benchmark-reference out of measured totals while preserving cost/model fields", () => {
    const events = [
      ...importRtkJson(rtkGainFixture),
      ...importHeadroomJson(headroomBenchmarkFixture),
    ];
    const summary = aggregateEvents(events);
    expect(summary.measuredSaved).toBe(1200);
    expect(
      events.find((event) => event.metricType === "benchmark-reference")?.model,
    ).toBe("benchmark-suite");
    expect(events[0]?.costBefore).toBe(0.02);
  });
});
