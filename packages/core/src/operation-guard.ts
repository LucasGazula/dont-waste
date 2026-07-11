import type { DataPaths } from "./paths.js";
import { restoreOperation, updateOperation } from "./operations.js";

const inFlight = new Set<Promise<unknown>>();

/** Track a child/async mutation so SIGINT can wait before snapshot restore. */
export function trackInFlight<T>(promise: Promise<T>): Promise<T> {
  inFlight.add(promise);
  return promise.finally(() => {
    inFlight.delete(promise);
  });
}

/** Wait for tracked children to settle (or until timeout). */
export async function waitForInFlight(timeoutMs = 7_000): Promise<void> {
  if (inFlight.size === 0) return;
  await Promise.race([
    Promise.allSettled([...inFlight]),
    new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs);
    }),
  ]);
}

/**
 * Restore snapshot then mark the operation failed.
 * Used for apply errors and SIGINT/SIGTERM so status never stays "running".
 */
export async function failOperationAfterInterrupt(
  paths: DataPaths,
  operationId: string,
  reason: string,
): Promise<void> {
  await restoreOperation(paths, operationId);
  await updateOperation(paths, operationId, "failed", reason);
}

export type OperationGuardControl = {
  signal: AbortSignal;
  /** Same abort → settle children → rollback path used by SIGINT/SIGTERM. */
  interrupt: (signal?: NodeJS.Signals) => Promise<void>;
};

export type OperationGuardOptions = {
  /** When false, do not call process.exit (tests). Default true. */
  exitOnSignal?: boolean;
  settleTimeoutMs?: number;
};

/**
 * Run work while SIGINT/SIGTERM abort children first, then rollback+failed.
 * Handlers are always removed on completion or error.
 */
export async function withOperationSignalGuards<T>(
  paths: DataPaths,
  operationId: string,
  work: (control: OperationGuardControl) => Promise<T>,
  options: OperationGuardOptions = {},
): Promise<T> {
  const controller = new AbortController();
  let settled = false;

  const handleInterrupt = async (
    signal: NodeJS.Signals = "SIGINT",
  ): Promise<void> => {
    if (settled) return;
    settled = true;
    controller.abort(signal);
    await waitForInFlight(options.settleTimeoutMs ?? 7_000);
    await failOperationAfterInterrupt(
      paths,
      operationId,
      `interrupted by ${signal}`,
    );
    if (options.exitOnSignal !== false) {
      process.exitCode = signal === "SIGINT" ? 130 : 143;
      process.exit(process.exitCode);
    }
  };

  const onSignal = (signal: NodeJS.Signals) => {
    void handleInterrupt(signal);
  };

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  try {
    return await work({
      signal: controller.signal,
      interrupt: handleInterrupt,
    });
  } catch (error) {
    if (!settled) {
      settled = true;
      controller.abort(error);
      await waitForInFlight(options.settleTimeoutMs ?? 7_000);
      await failOperationAfterInterrupt(
        paths,
        operationId,
        error instanceof Error ? error.message : String(error),
      );
    }
    throw error;
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}
