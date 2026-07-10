import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createOperation,
  getDataPaths,
  restoreOperation,
} from "../src/index.js";

describe("configuration snapshots", () => {
  it("restores an existing file and removes a file that did not exist before the operation", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "dont-waste-"));
    const paths = getDataPaths("linux", {
      ...process.env,
      DONT_WASTE_DATA_DIR: root,
    });
    const existing = path.join(root, "agent.json");
    const created = path.join(root, "created.json");
    await writeFile(existing, "before");
    const operation = await createOperation(paths, "init", { example: true }, [
      existing,
      created,
    ]);
    await writeFile(existing, "after");
    await writeFile(created, "new");
    await restoreOperation(paths, operation.id);
    expect(await readFile(existing, "utf8")).toBe("before");
    await expect(readFile(created, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
