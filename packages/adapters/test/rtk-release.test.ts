import { createHash } from "node:crypto";
import { access, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { installRtkFromOfficialRelease, parseChecksumLine, resolveRtkTarget, sha256 } from "../src/rtk-release.js";

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
  const padded = Buffer.concat([data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
  return Buffer.concat([header, padded, Buffer.alloc(1024)]);
}

describe("rtk official release install", () => {
  it("resolves platform assets and parses checksum lines", () => {
    expect(resolveRtkTarget("linux", "x64").asset).toBe("rtk-x86_64-unknown-linux-musl.tar.gz");
    expect(resolveRtkTarget("darwin", "arm64").asset).toBe("rtk-aarch64-apple-darwin.tar.gz");
    expect(resolveRtkTarget("win32", "x64").asset).toBe("rtk-x86_64-pc-windows-msvc.zip");
    expect(parseChecksumLine("abc123def4567890abc123def4567890abc123def4567890abc123def4567890  rtk-x86_64-unknown-linux-musl.tar.gz\n", "rtk-x86_64-unknown-linux-musl.tar.gz"))
      .toBe("abc123def4567890abc123def4567890abc123def4567890abc123def4567890");
  });

  it("refuses checksum mismatches and installs when the digest matches", async () => {
    const archive = gzipSync(tarOfSingleFile("rtk", "#!/bin/sh\necho rtk\n"));
    const digest = sha256(archive);
    const asset = "rtk-x86_64-unknown-linux-musl.tar.gz";
    const installDir = await mkdtemp(path.join(os.tmpdir(), "dont-waste-rtk-bin-"));

    await expect(installRtkFromOfficialRelease({
      platform: "linux",
      arch: "x64",
      tag: "v0.0.0-test",
      installDir,
      fetchImpl: (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("checksums.txt")) return new Response(`deadbeef${"0".repeat(56)}  ${asset}\n`);
        if (url.endsWith(asset)) return new Response(archive);
        throw new Error(`unexpected url ${url}`);
      }) as typeof fetch,
    })).rejects.toThrow(/checksum mismatch/);

    const result = await installRtkFromOfficialRelease({
      platform: "linux",
      arch: "x64",
      tag: "v0.0.0-test",
      installDir,
      fetchImpl: (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("checksums.txt")) return new Response(`${digest}  ${asset}\n`);
        if (url.endsWith(asset)) return new Response(archive);
        throw new Error(`unexpected url ${url}`);
      }) as typeof fetch,
    });

    expect(result.checksum).toBe(digest);
    expect(result.binaryPath).toBe(path.join(installDir, "rtk"));
    await access(result.binaryPath);
    expect(createHash("sha256").update(archive).digest("hex")).toBe(digest);
  });
});
