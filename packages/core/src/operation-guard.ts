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

/** Wait for tracked children to settle (or until timeout). Always clears the timer. */
export async function waitForInFlight(timeoutMs = 7_000): Promise<void> {
  if (inFlight.size === 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.allSettled([...inFlight]),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
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
  let restoreError: Error | undefined;
  try {
    await restoreOperation(paths, operationId);
  } catch (err) {
    restoreError = err instanceof Error ? err : new Error(String(err));
    console.error(
      `Rollback failed during interruption recovery: ${restoreError.message}`,
    );
  }

  const finalReason = restoreError
    ? `${reason} (Rollback failed: ${restoreError.message})`
    : reason;

  await updateOperation(paths, operationId, "failed", finalReason);
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
 * Rollback errors are best-effort (never unhandled rejections).
 */
export async function withOperationSignalGuards<T>(
  paths: DataPaths,
  operationId: string,
  work: (control: OperationGuardControl) => Promise<T>,
  options: OperationGuardOptions = {},
): Promise<T> {
  const controller = new AbortController();
  let settled = false;

  const rollbackBestEffort = async (reason: string): Promise<void> => {
    try {
      await waitForInFlight(options.settleTimeoutMs ?? 7_000);
      await failOperationAfterInterrupt(paths, operationId, reason);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error(
        `Critical: Failed to update operation ${operationId} status to failed after rollback: ${err.message}`,
      );
    }
  };

  const handleInterrupt = async (
    signal: NodeJS.Signals = "SIGINT",
  ): Promise<void> => {
    if (settled) return;
    settled = true;
    controller.abort(signal);
    await rollbackBestEffort(`interrupted by ${signal}`);
    if (options.exitOnSignal !== false) {
      if (signal === "SIGINT") {
        process.exitCode = 130;
      } else if (signal === "SIGHUP") {
        process.exitCode = 129;
      } else {
        process.exitCode = 143;
      }
      process.exit(process.exitCode);
    }
  };

  const onSignal = (signal: NodeJS.Signals) => {
    void handleInterrupt(signal).catch(() => undefined);
  };

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  process.on("SIGHUP", onSignal);
  try {
    return await work({
      signal: controller.signal,
      interrupt: handleInterrupt,
    });
  } catch (error) {
    if (!settled) {
      settled = true;
      controller.abort(error);
      await rollbackBestEffort(
        error instanceof Error ? error.message : String(error),
      );
    }
    throw error;
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    process.off("SIGHUP", onSignal);
  }
}
