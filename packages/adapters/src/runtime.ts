import { execa } from "execa";
import type { Command, DetectionResult } from "./types.js";

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
): Promise<{ ran: boolean; error?: string }> {
  if (dryRun || command.interactive) return { ran: false };
  const result = await execa(command.command, command.args, {
    reject: false,
    shell: command.shell ?? false,
    stdio: "inherit",
  });
  return result.exitCode === 0
    ? { ran: true }
    : { ran: true, error: `${command.label} exited with ${result.exitCode}` };
}
