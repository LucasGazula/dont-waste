import { createHash } from "node:crypto";
import { access, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  findExtractedBinary,
  fetchWithTimeout,
  installRtkFromOfficialRelease,
  parseChecksumLine,
  resolveRtkTarget,
  sha256,
} from "../src/rtk-release.js";
import { rtkInitArgs, RtkAdapter, RTK_RELEASE_LABEL } from "../src/rtk.js";

function tarOfSingleFile(name: string, content: string): Buffer {
  const data = Buffer.from(content, "utf8");
  const header = Buffer.alloc(512);
  header.write(name);
  header.write("0000644", 100, 7, "utf8");
  header.write("0000000", 108, 7, "utf8");
  header.write("0000000", 116, 7, "utf8");
  header.write(data.length.toString(8).padStart(11, "0"), 124, 11, "utf8");
  header.write("00000000000", 136, 11, "utf8");
  header.write("0", 156, 1, "utf8");
  header.write("ustar\0", 257, 6, "utf8");
  header.write("00", 263, 2, "utf8");
  let sum = 0;
  for (let i = 0; i < header.length; i += 1) sum += header[i]!;
  for (let i = 148; i < 156; i += 1) sum += " ".charCodeAt(0) - header[i]!;
  header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "utf8");
  const padded = Buffer.concat([
    data,
    Buffer.alloc((512 - (data.length % 512)) % 512),
  ]);
  return Buffer.concat([header, padded, Buffer.alloc(1024)]);
}

describe("rtk official release install", () => {
  it("resolves platform assets and parses checksum lines", () => {
    expect(resolveRtkTarget("linux", "x64").asset).toBe(
      "rtk-x86_64-unknown-linux-musl.tar.gz",
    );
    expect(resolveRtkTarget("darwin", "arm64").asset).toBe(
      "rtk-aarch64-apple-darwin.tar.gz",
    );
    expect(resolveRtkTarget("win32", "x64").asset).toBe(
      "rtk-x86_64-pc-windows-msvc.zip",
    );
    expect(
      parseChecksumLine(
        "abc123def4567890abc123def4567890abc123def4567890abc123def4567890  rtk-x86_64-unknown-linux-musl.tar.gz\n",
        "rtk-x86_64-unknown-linux-musl.tar.gz",
      ),
    ).toBe("abc123def4567890abc123def4567890abc123def4567890abc123def4567890");
  });

  it("uses official init flags per agent", () => {
    expect(rtkInitArgs("codex")).toEqual(["init", "-g", "--codex"]);
    expect(rtkInitArgs("opencode")).toEqual(["init", "-g", "--opencode"]);
    expect(rtkInitArgs("antigravity-cli")).toEqual([
      "init",
      "--agent",
      "antigravity",
    ]);
    expect(rtkInitArgs("pi")).toEqual(["init", "-g", "--agent", "pi"]);
    expect(rtkInitArgs("copilot-cli")).toEqual(["init", "-g", "--copilot"]);
  });

  it("finds nested extracted binaries", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "dont-waste-rtk-find-"));
    await mkdir(path.join(root, "nested"), { recursive: true });
    await writeFile(path.join(root, "nested", "rtk"), "#!/bin/sh\n", "utf8");
    expect(await findExtractedBinary(root, "rtk")).toBe(
      path.join(root, "nested", "rtk"),
    );
  });

  it("refuses checksum mismatches and installs when the digest matches", async () => {
    const archive = gzipSync(tarOfSingleFile("rtk", "#!/bin/sh\necho rtk\n"));
    const digest = sha256(archive);
    const asset = "rtk-x86_64-unknown-linux-musl.tar.gz";
    const installDir = await mkdtemp(
      path.join(os.tmpdir(), "dont-waste-rtk-bin-"),
    );

    await expect(
      installRtkFromOfficialRelease({
        platform: "linux",
        arch: "x64",
        tag: "v0.0.0-test",
        installDir,
        fetchImpl: (async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url.endsWith("checksums.txt"))
            return new Response(`deadbeef${"0".repeat(56)}  ${asset}\n`);
          if (url.endsWith(asset)) return new Response(archive);
          throw new Error(`unexpected url ${url}`);
        }) as typeof fetch,
      }),
    ).rejects.toThrow(/checksum mismatch/);

    const result = await installRtkFromOfficialRelease({
      platform: "linux",
      arch: "x64",
      tag: "v0.0.0-test",
      installDir,
      fetchImpl: (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("checksums.txt"))
          return new Response(`${digest}  ${asset}\n`);
        if (url.endsWith(asset)) return new Response(archive);
        throw new Error(`unexpected url ${url}`);
      }) as typeof fetch,
    });

    expect(result.checksum).toBe(digest);
    expect(result.binaryPath).toBe(path.join(installDir, "rtk"));
    await access(result.binaryPath);
    expect(createHash("sha256").update(archive).digest("hex")).toBe(digest);
  });

  it("aborts fetchWithTimeout when the external signal fires", async () => {
    const controller = new AbortController();
    const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      return await new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          return;
        }
        signal?.addEventListener(
          "abort",
          () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          },
          { once: true },
        );
      });
    }) as typeof fetch;

    const pending = fetchWithTimeout(
      "https://example.test/rtk",
      fetchImpl,
      {},
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toThrow(/Aborted while fetching/);
  });

  it("refuses official-release install when abortSignal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let fetched = false;
    await expect(
      installRtkFromOfficialRelease({
        platform: "linux",
        arch: "x64",
        tag: "v0.0.0-test",
        installDir: await mkdtemp(path.join(os.tmpdir(), "dont-waste-rtk-ab-")),
        abortSignal: controller.signal,
        fetchImpl: (async () => {
          fetched = true;
          return new Response("nope");
        }) as typeof fetch,
      }),
    ).rejects.toThrow(/aborted/i);
    expect(fetched).toBe(false);
  });

  it("passes AdapterContext.abortSignal into the official-release install path", async () => {
    const adapter = new RtkAdapter();
    const controller = new AbortController();
    controller.abort();
    const result = await adapter.install(
      {
        tool: "rtk",
        selection: { mode: "full", features: {} },
        commands: [
          {
            command: "dont-waste-internal",
            args: ["rtk-release-install", "fake"],
            label: RTK_RELEASE_LABEL,
          },
        ],
        warnings: [],
        affectedPaths: [],
        capabilities: [],
      },
      {
        platform: process.platform,
        home: os.tmpdir(),
        selectedAgents: ["codex"],
        dryRun: false,
        abortSignal: controller.signal,
      },
    );
    expect(result.succeeded).toBe(false);
    expect(result.errors.join(" ")).toMatch(/abort/i);
  });
});
