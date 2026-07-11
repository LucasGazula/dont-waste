import { execa } from "execa";
import type { Command, DetectionResult, RunCommandHooks } from "./types.js";

/** Default bound for non-interactive upstream installers (avoids infinite prompt hangs). */
export const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
export const DEFAULT_FORCE_KILL_MS = 5_000;

export async function findExecutable(
  command: string,
  platform = process.platform,
): Promise<string | undefined> {
  try {
    const result = await execa(
      platform === "win32" ? "where" : "command",
      platform === "win32" ? [command] : ["-v", command],
      { reject: false, shell: platform !== "win32" },
    );
    const first = result.stdout.split(/\r?\n/).find(Boolean);
    return result.exitCode === 0 && first ? first.trim() : undefined;
  } catch {
    return undefined;
  }
}

export async function executableDetection(
  id: string,
  executable: string,
): Promise<DetectionResult> {
  const resolved = await findExecutable(executable);
  if (!resolved)
    return { id, detected: false, warnings: [`${executable} is not on PATH`] };
  try {
    const result = await execa(executable, ["--version"], {
      reject: false,
      timeout: 3_000,
      forceKillAfterDelay: false,
    });
    const version = (result.stdout || result.stderr).split(/\r?\n/)[0]?.trim();
    return {
      id,
      detected: true,
      path: resolved,
      version: version || undefined,
      warnings: result.timedOut
        ? [`${executable} did not return a version within 3 seconds`]
        : [],
    };
  } catch (error) {
    return {
      id,
      detected: true,
      path: resolved,
      warnings: [
        `${executable} is on PATH but its version could not be read: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
}

export async function runCommand(
  command: Command,
  dryRun: boolean,
  hooks: RunCommandHooks = {},
): Promise<{ ran: boolean; error?: string }> {
  await hooks.beforeCommand?.(command);
  if (dryRun || command.interactive) return { ran: false };

  const timeout =
    command.timeoutMs === undefined
      ? DEFAULT_COMMAND_TIMEOUT_MS
      : command.timeoutMs;
  const forceKillAfterDelay =
    command.forceKillAfterDelay === undefined
      ? DEFAULT_FORCE_KILL_MS
      : command.forceKillAfterDelay;

  const result = await execa(command.command, command.args, {
    reject: false,
    shell: command.shell ?? false,
    stdio: "inherit",
    ...(command.env
      ? { env: { ...process.env, ...command.env } as NodeJS.ProcessEnv }
      : {}),
    timeout,
    forceKillAfterDelay,
  });

  if (result.timedOut) {
    return {
      ran: true,
      error: `${command.label} timed out after ${timeout}ms (possible interactive prompt or hang)`,
    };
  }
  return result.exitCode === 0
    ? { ran: true }
    : { ran: true, error: `${command.label} exited with ${result.exitCode}` };
}
