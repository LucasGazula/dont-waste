import { mkdtemp, readFile, rm, access, constants } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const installSh = path.join(root, "scripts/install.sh");
const installPs1 = path.join(root, "scripts/install.ps1");

const tempDirs: string[] = [];

async function makeTemp(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, ...env },
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

afterEach(async () => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("local bootstrap installer seams", () => {
  it("install.sh --help documents dry-run, prefix, and no agent config", async () => {
    const result = await run("bash", [installSh, "--help"], {});
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/--dry-run/);
    expect(result.stdout).toMatch(/--prefix/);
    expect(result.stdout).toMatch(/--uninstall/);
    expect(result.stdout.toLowerCase()).toMatch(/does not|não|nao/);
    expect(result.stdout).not.toMatch(/npm install --global/);
    expect(result.stdout).not.toMatch(/curl .*\|.*bash/);
  });

  it("install.sh --dry-run prints planned bootstrap without writing shim or PATH", async () => {
    const prefix = await makeTemp("dw-prefix-");
    const home = await makeTemp("dw-home-");
    const result = await run(
      "bash",
      [installSh, "--dry-run", "--prefix", prefix],
      { HOME: home, DONT_WASTE_PREFIX: prefix },
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/pnpm install/);
    expect(result.stdout).toMatch(/pnpm build/);
    expect(result.stdout).toMatch(/dont-waste/);
    expect(result.stdout).toMatch(prefix);
    expect(result.stdout.toLowerCase()).toMatch(
      /does not configure agents|not touch|unchanged/,
    );
    await expect(
      access(path.join(prefix, "bin", "dont-waste"), constants.F_OK),
    ).rejects.toThrow();
  });

  it("install.ps1 declares Help/DryRun/Prefix/Uninstall and local checkout flow", async () => {
    const text = await readFile(installPs1, "utf8");
    expect(text).toMatch(/\[switch\]\$Help/);
    expect(text).toMatch(/\[switch\]\$DryRun/);
    expect(text).toMatch(/\$Prefix/);
    expect(text).toMatch(/\[switch\]\$Uninstall/);
    expect(text).toMatch(/pnpm install/);
    expect(text).toMatch(/pnpm build/);
    expect(text).not.toMatch(/npm install --global/);
    expect(text).not.toMatch(/dont-waste init @args/);
    expect(text).toMatch(/apps[\\/]cli[\\/]dist[\\/]main\.js/);
    expect(text).toMatch(/Does not run the CLI init command/);
  });

  it("install.sh links a reversible dont-waste shim under a temp prefix", async () => {
    const prefix = await makeTemp("dw-prefix-");
    const home = await makeTemp("dw-home-");
    const result = await run("bash", [installSh, "--prefix", prefix], {
      HOME: home,
      DONT_WASTE_PREFIX: prefix,
      DONT_WASTE_INSTALL_SKIP_FETCH: "1",
    });
    expect(result.code).toBe(0);
    const shim = path.join(prefix, "bin", "dont-waste");
    const cliEntry = path.join(root, "apps/cli/dist/main.js");
    const shimBody = await readFile(shim, "utf8");
    expect(shimBody).toContain("dont-waste-local-bootstrap");
    expect(shimBody).toContain(cliEntry);

    const syntax = await run("bash", ["-n", shim], { HOME: home });
    expect(syntax.code).toBe(0);
    await access(cliEntry, constants.F_OK);

    const uninstall = await run(
      "bash",
      [installSh, "--uninstall", "--prefix", prefix],
      { HOME: home, DONT_WASTE_PREFIX: prefix },
    );
    expect(uninstall.code).toBe(0);
    await expect(access(shim, constants.F_OK)).rejects.toThrow();
  }, 60_000);
});
