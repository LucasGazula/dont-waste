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

  it("restores an existing skill symlink and removes a created one", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "dont-waste-links-"));
    const paths = getDataPaths("linux", {
      ...process.env,
      DONT_WASTE_DATA_DIR: root,
    });
    const canonical = path.join(root, "canonical-caveman");
    const existingLink = path.join(root, "codex", "skills", "caveman");
    const createdLink = path.join(root, "antigravity", "skills", "caveman");
    await mkdir(canonical, { recursive: true });
    await writeFile(path.join(canonical, "SKILL.md"), "canonical\n");
    await mkdir(path.dirname(existingLink), { recursive: true });
    await symlink(canonical, existingLink, "dir");

    const operation = await createOperation(
      paths,
      "init",
      { profile: "custom" },
      [existingLink, createdLink],
    );
    await rm(existingLink, { force: true });
    await mkdir(path.dirname(createdLink), { recursive: true });
    await symlink(canonical, createdLink, "dir");

    await restoreOperation(paths, operation.id);

    expect(await readlink(existingLink)).toBe(canonical);
    await expect(readlink(createdLink)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("restores an existing skill directory recursively", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "dont-waste-dir-"));
    const paths = getDataPaths("linux", {
      ...process.env,
      DONT_WASTE_DATA_DIR: root,
    });
    const skillDir = path.join(root, "skills", "caveman");
    await mkdir(path.join(skillDir, "nested"), { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), "user skill\n");
    await writeFile(path.join(skillDir, "nested", "notes.md"), "keep me\n");

    const operation = await createOperation(
      paths,
      "init",
      { profile: "custom" },
      [skillDir],
    );
    await rm(skillDir, { recursive: true, force: true });
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "replacement.md"), "discard me\n");

    await restoreOperation(paths, operation.id);

    expect(await readFile(path.join(skillDir, "SKILL.md"), "utf8")).toBe(
      "user skill\n",
    );
    expect(
      await readFile(path.join(skillDir, "nested", "notes.md"), "utf8"),
    ).toBe("keep me\n");
    await expect(
      readFile(path.join(skillDir, "replacement.md"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
