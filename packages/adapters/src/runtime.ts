import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { trackInFlight } from "@dont-waste/core";
import { execa } from "execa";
import type {
  Command,
  DetectionResult,
  RunCommandHooks,
  AdapterContext,
  HealthCheck,
} from "./types.js";

/** Default bound for non-interactive upstream installers (avoids infinite prompt hangs). */
export const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
export const DEFAULT_FORCE_KILL_MS = 5_000;
export const FIND_EXECUTABLE_TIMEOUT_MS = 3_000;

export async function findExecutable(
  command: string,
  platform = process.platform,
  abortSignal?: AbortSignal,
): Promise<string | undefined> {
  try {
    const result = await trackInFlight(
      execa(
        platform === "win32" ? "where" : "command",
        platform === "win32" ? [command] : ["-v", command],
        {
          reject: false,
          shell: platform !== "win32",
          timeout: FIND_EXECUTABLE_TIMEOUT_MS,
          forceKillAfterDelay: DEFAULT_FORCE_KILL_MS,
          ...(abortSignal ? { cancelSignal: abortSignal } : {}),
        },
      ),
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
  abortSignal?: AbortSignal,
): Promise<DetectionResult> {
  const resolved = await findExecutable(
    executable,
    process.platform,
    abortSignal,
  );
  if (!resolved)
    return { id, detected: false, warnings: [`${executable} is not on PATH`] };
  try {
    const result = await trackInFlight(
      execa(executable, ["--version"], {
        reject: false,
        timeout: 3_000,
        forceKillAfterDelay: DEFAULT_FORCE_KILL_MS,
        ...(abortSignal ? { cancelSignal: abortSignal } : {}),
      }),
    );
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

function runCommandHooksFromContext(hooks: RunCommandHooks): RunCommandHooks {
  const next: RunCommandHooks = {};
  if (hooks.beforeCommand) next.beforeCommand = hooks.beforeCommand;
  if (hooks.abortSignal) next.abortSignal = hooks.abortSignal;
  return next;
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

  try {
    const result = await trackInFlight(
      execa(command.command, command.args, {
        reject: false,
        shell: command.shell ?? false,
        stdio: command.interactive
          ? "inherit"
          : ["ignore", "inherit", "inherit"],
        ...(command.env
          ? { env: { ...process.env, ...command.env } as NodeJS.ProcessEnv }
          : {}),
        ...(hooks.abortSignal ? { cancelSignal: hooks.abortSignal } : {}),
        timeout,
        forceKillAfterDelay,
      }),
    );

    if (hooks.abortSignal?.aborted) {
      return {
        ran: true,
        error: `${command.label} aborted before completion`,
      };
    }
    if (result.timedOut) {
      return {
        ran: true,
        error: `${command.label} timed out after ${timeout}ms (possible interactive prompt or hang)`,
      };
    }
    if (result.isCanceled) {
      return {
        ran: true,
        error: `${command.label} aborted before completion`,
      };
    }
    return result.exitCode === 0
      ? { ran: true }
      : { ran: true, error: `${command.label} exited with ${result.exitCode}` };
  } catch (error) {
    if (hooks.abortSignal?.aborted) {
      return {
        ran: true,
        error: `${command.label} aborted before completion`,
      };
    }
    return {
      ran: true,
      error: `${command.label} failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function commandHooksFromAdapterContext(context: {
  beforeCommand?: RunCommandHooks["beforeCommand"];
  abortSignal?: AbortSignal | undefined;
}): RunCommandHooks {
  return runCommandHooksFromContext({
    beforeCommand: context.beforeCommand,
    abortSignal: context.abortSignal,
  });
}

export async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const info = await stat(dirPath);
    return info.isDirectory();
  } catch {
    return false;
  }
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath);
    return info.isFile();
  } catch {
    return false;
  }
}

export async function getActiveCodexProcesses(
  context: Pick<AdapterContext, "home" | "platform">,
): Promise<{ pid: number; cmdline: string }[]> {
  if (process.env.DONT_WASTE_MOCK_CODEX_PROCESSES) {
    try {
      return JSON.parse(process.env.DONT_WASTE_MOCK_CODEX_PROCESSES);
    } catch {
      return [];
    }
  }

  if (process.env.VITEST) {
    return [];
  }

  if (context.platform !== "linux" && process.platform !== "linux") {
    return [];
  }

  const codexHome = process.env.CODEX_HOME ?? path.join(context.home, ".codex");
  const resolvedTarget = path.resolve(codexHome);
  const active: { pid: number; cmdline: string }[] = [];

  try {
    const entries = await readdir("/proc");
    for (const entry of entries) {
      if (!/^\d+$/.test(entry)) continue;
      const pid = parseInt(entry, 10);
      try {
        const cmdline = await readFile(
          path.join("/proc", entry, "cmdline"),
          "utf8",
        );
        const lowerCmd = cmdline.toLowerCase();
        if (!lowerCmd.includes("codex")) {
          continue;
        }

        const environ = await readFile(
          path.join("/proc", entry, "environ"),
          "utf8",
        );
        const envs = environ.split("\0");
        let processCodexHome: string | undefined;
        let processHome: string | undefined;

        for (const env of envs) {
          if (env.startsWith("CODEX_HOME=")) {
            processCodexHome = env.slice("CODEX_HOME=".length);
          } else if (env.startsWith("HOME=")) {
            processHome = env.slice("HOME=".length);
          }
        }

        const resolvedProcessHome = processCodexHome
          ? path.resolve(processCodexHome)
          : processHome
            ? path.resolve(path.join(processHome, ".codex"))
            : undefined;

        if (resolvedProcessHome && resolvedProcessHome === resolvedTarget) {
          const cmdDisplay = cmdline.split("\0").filter(Boolean).join(" ");
          active.push({ pid, cmdline: cmdDisplay });
        }
      } catch {
        // Ignore read errors
      }
    }
  } catch {
    // Ignore proc fs errors
  }

  return active;
}

export async function getCodexRuntimeDiagnostic(
  context: Pick<AdapterContext, "platform" | "home" | "abortSignal">,
): Promise<HealthCheck> {
  const codexHome = process.env.CODEX_HOME ?? path.join(context.home, ".codex");
  const codexPath = await findExecutable(
    "codex",
    context.platform,
    context.abortSignal,
  );
  let version = "unknown";

  if (codexPath) {
    try {
      const { stdout } = await execa(codexPath, ["--version"], {
        timeout: 3000,
        ...(context.abortSignal ? { cancelSignal: context.abortSignal } : {}),
      });
      version = stdout.trim();
    } catch {
      // ignore
    }
  }

  let authState = "unknown";
  try {
    await access(path.join(codexHome, "auth.json"));
    authState = "auth.json present";
  } catch {
    authState = "auth.json missing (codex login required)";
  }

  const orcaNote = codexHome.includes("codex-runtime-home")
    ? " Orca managed home: also keep MCP/plugins in the Windows system ~/.codex because Orca merges system config into runtime and only preserves hooks/projects from runtime."
    : "";

  const message = `Codex Runtime: binary=${codexPath || "not found"}, version=${version}, effective CODEX_HOME=${codexHome}, ${authState}.${orcaNote}`;

  return {
    id: "codex-runtime-diagnostic",
    status: authState.includes("missing") ? "warn" : "pass",
    message,
    blocksActivation: false,
  };
}

export async function isCodexMarketplaceAvailable(
  context: Pick<AdapterContext, "platform" | "home" | "abortSignal">,
): Promise<boolean> {
  if (process.env.DONT_WASTE_MOCK_CODEX_MARKETPLACE) {
    return process.env.DONT_WASTE_MOCK_CODEX_MARKETPLACE === "true";
  }
  try {
    const codexPath = await findExecutable(
      "codex",
      context.platform,
      context.abortSignal,
    );
    if (!codexPath) return false;
    const { stdout } = await execa(
      codexPath,
      ["plugin", "marketplace", "list"],
      {
        env: {
          ...process.env,
          ...(process.env.CODEX_HOME
            ? { CODEX_HOME: process.env.CODEX_HOME }
            : {}),
        },
        timeout: 5000,
        ...(context.abortSignal ? { cancelSignal: context.abortSignal } : {}),
      },
    );
    return stdout.split("\n").some((line) => {
      const parts = line.trim().split(/\s+/);
      return parts[0] === "ponytail";
    });
  } catch {
    return false;
  }
}
