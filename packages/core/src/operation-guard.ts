import type { DataPaths } from "./paths.js";
import { restoreOperation, updateOperation } from "./operations.js";

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

/**
 * Run work while SIGINT/SIGTERM trigger rollback+failed, then clear handlers.
 */
export async function withOperationSignalGuards<T>(
  paths: DataPaths,
  operationId: string,
  work: () => Promise<T>,
): Promise<T> {
  let settled = false;
  const onSignal = (signal: NodeJS.Signals) => {
    if (settled) return;
    settled = true;
    void failOperationAfterInterrupt(
      paths,
      operationId,
      `interrupted by ${signal}`,
    ).finally(() => {
      process.exitCode = signal === "SIGINT" ? 130 : 143;
      process.exit(process.exitCode);
    });
  };

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  try {
    return await work();
  } catch (error) {
    if (!settled) {
      settled = true;
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
