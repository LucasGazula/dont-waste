import { describe, expect, it } from "vitest";
import { runCommand } from "../src/runtime.js";

describe("runCommand hang and env seams", () => {
  it("skips interactive commands without spawning", async () => {
    const result = await runCommand(
      {
        command: process.execPath,
        args: ["-e", "process.exit(1)"],
        label: "interactive probe",
        interactive: true,
      },
      false,
    );
    expect(result).toEqual({ ran: false });
  });

  it("bounds a hanging child with timeout and forceKill", async () => {
    const started = Date.now();
    const result = await runCommand(
      {
        command: process.execPath,
        args: ["-e", "setTimeout(() => {}, 60_000)"],
        label: "hang forever",
        timeoutMs: 400,
        forceKillAfterDelay: 100,
      },
      false,
    );
    const elapsed = Date.now() - started;
    expect(result.ran).toBe(true);
    expect(result.error).toMatch(/timed out/i);
    expect(elapsed).toBeLessThan(15_000);
  }, 20_000);

  it("passes command.env to the child process", async () => {
    const result = await runCommand(
      {
        command: process.execPath,
        args: [
          "-e",
          "process.exit(process.env.RTK_TELEMETRY_DISABLED === '1' ? 0 : 2)",
        ],
        label: "env probe",
        env: { RTK_TELEMETRY_DISABLED: "1" },
        timeoutMs: 5_000,
        forceKillAfterDelay: 1_000,
      },
      false,
    );
    expect(result).toEqual({ ran: true });
  });

  it("invokes beforeCommand before spawning a non-interactive child", async () => {
    const seen: string[] = [];
    const result = await runCommand(
      {
        command: process.execPath,
        args: ["-e", "process.exit(0)"],
        label: "progress probe",
        timeoutMs: 5_000,
      },
      false,
      {
        beforeCommand: (command) => {
          seen.push(command.label);
        },
      },
    );
    expect(result).toEqual({ ran: true });
    expect(seen).toEqual(["progress probe"]);
  });
});
