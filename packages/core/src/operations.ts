import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DataPaths } from "./paths.js";

export type FileSnapshot = { path: string; contents: string | null };
export type OperationStatus =
  "planned" | "running" | "succeeded" | "failed" | "rolled-back";
export type Operation = {
  id: string;
  type: "init" | "update" | "rollback" | "uninstall";
  createdAt: string;
  status: OperationStatus;
  plan: unknown;
  snapshotFile: string;
  error?: string;
};

type State = { schemaVersion: 1; operations: Operation[] };
const emptyState = (): State => ({ schemaVersion: 1, operations: [] });

async function readState(paths: DataPaths): Promise<State> {
  try {
    return JSON.parse(await readFile(paths.state, "utf8")) as State;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
    throw error;
  }
}
async function writeState(paths: DataPaths, state: State): Promise<void> {
  await mkdir(paths.root, { recursive: true });
  await writeFile(paths.state, `${JSON.stringify(state, null, 2)}\n`);
}

export async function createOperation(
  paths: DataPaths,
  type: Operation["type"],
  plan: unknown,
  affectedPaths: string[],
): Promise<Operation> {
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
  const snapshots: FileSnapshot[] = await Promise.all(
    affectedPaths.map(async (file) => {
      try {
        const isBinary = file.endsWith("rtk") || file.endsWith("rtk.exe");
        const raw = await readFile(file);
        const contents = isBinary
          ? raw.toString("base64")
          : raw.toString("utf8");
        return { path: file, contents };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          return { path: file, contents: null };
        throw error;
      }
    }),
  );
  await mkdir(paths.backups, { recursive: true });
  const snapshotFile = path.join(paths.backups, `${id}.json`);
  await writeFile(
    snapshotFile,
    `${JSON.stringify(snapshots, null, 2)}\n`,
    "utf8",
  );
  const operation: Operation = {
    id,
    type,
    createdAt: new Date().toISOString(),
    status: "planned",
    plan,
    snapshotFile,
  };
  const state = await readState(paths);
  state.operations.push(operation);
  await writeState(paths, state);
  return operation;
}

export async function updateOperation(
  paths: DataPaths,
  id: string,
  status: OperationStatus,
  error?: string,
): Promise<void> {
  const state = await readState(paths);
  const operation = state.operations.find((item) => item.id === id);
  if (!operation) throw new Error(`Operation ${id} was not found`);
  operation.status = status;
  if (error) operation.error = error;
  await writeState(paths, state);
}

export async function listOperations(paths: DataPaths): Promise<Operation[]> {
  return (await readState(paths)).operations;
}

export async function restoreOperation(
  paths: DataPaths,
  id: string,
): Promise<Operation> {
  const operation = (await readState(paths)).operations.find(
    (item) => item.id === id,
  );
  if (!operation) throw new Error(`Operation ${id} was not found`);
  const snapshots = JSON.parse(
    await readFile(operation.snapshotFile, "utf8"),
  ) as FileSnapshot[];
  for (const snapshot of snapshots) {
    if (snapshot.contents === null) await rm(snapshot.path, { force: true });
    else {
      await mkdir(path.dirname(snapshot.path), { recursive: true });
      const isBinary =
        snapshot.path.endsWith("rtk") || snapshot.path.endsWith("rtk.exe");
      const buffer = isBinary
        ? Buffer.from(snapshot.contents, "base64")
        : Buffer.from(snapshot.contents, "utf8");
      await writeFile(snapshot.path, buffer);
    }
  }
  await updateOperation(paths, id, "rolled-back");
  return operation;
}
