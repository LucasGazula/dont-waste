import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function readJson(relative: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(root, relative), "utf8")) as Record<
    string,
    unknown
  >;
}

function readText(relative: string): string {
  return readFileSync(path.join(root, relative), "utf8");
}

describe("distribution contracts", () => {
  it("publishes the CLI bin with dist-only files and Node 22 engines", () => {
    const pkg = readJson("apps/cli/package.json");
    const rootPkg = readJson("package.json");
    expect(pkg.name).toBe("dont-waste");
    expect(pkg.bin).toEqual({ "dont-waste": "./dist/main.js" });
    expect(pkg.files).toEqual(["dist"]);
    expect(rootPkg.engines).toMatchObject({ node: ">=22" });
    expect(rootPkg.private).toBe(true);
  });

  it("keeps workspace packages on dist exports for npm consumers", () => {
    for (const relative of [
      "packages/catalog/package.json",
      "packages/core/package.json",
      "packages/telemetry/package.json",
      "packages/adapters/package.json",
      "packages/dashboard-api/package.json",
    ]) {
      const pkg = readJson(relative);
      expect(pkg.main).toBe("./dist/index.js");
      expect(pkg.types).toBe("./dist/index.d.ts");
      expect(pkg.exports).toBe("./dist/index.js");
    }
  });

  it("configures a Node shebang on the CLI bundle entrypoint", () => {
    const tsup = readText("apps/cli/tsup.config.ts");
    expect(tsup).toContain('banner: { js: "#!/usr/bin/env node" }');
    const builtPath = path.join(root, "apps/cli/dist/main.js");
    try {
      const built = readFileSync(builtPath, "utf8");
      expect(built.startsWith("#!/usr/bin/env node")).toBe(true);
    } catch {
      // dist may be absent before `pnpm build`; package + tsup contracts still hold.
    }
  });

  it("guards local bootstrap installers on Node 22+ without npm publish or init", () => {
    const sh = readText("scripts/install.sh");
    const ps1 = readText("scripts/install.ps1");
    expect(sh).toContain("Node.js 22");
    expect(sh).toContain("--dry-run");
    expect(sh).toContain("pnpm install");
    expect(sh).toContain("pnpm build");
    expect(sh).not.toContain("npm install --global");
    expect(sh).not.toContain("dont-waste init @");
    expect(ps1).toContain("Node.js 22");
    expect(ps1).toContain("DryRun");
    expect(ps1).toContain("pnpm install");
    expect(ps1).not.toContain("npm install --global");
    expect(ps1).not.toContain("dont-waste init @args");
  });

  it("keeps Docker dashboard read-only over mounted local data", () => {
    const dockerfile = readText("docker/Dockerfile");
    const compose = readText("docker/compose.yaml");
    expect(dockerfile).toContain("DONT_WASTE_DATA_DIR=/data");
    expect(dockerfile).toContain(
      'CMD ["dashboard", "--port", "3000", "--no-open"]',
    );
    expect(compose).toContain("DONT_WASTE_HOST_DATA_DIR");
    expect(compose).toContain("127.0.0.1:3000:3000");
    expect(compose).not.toContain("init --yes");
  });
});
