import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";

const REPO = "rtk-ai/rtk";

export type RtkTarget = {
  asset: string;
  archiveKind: "tar.gz" | "zip";
};

export function resolveRtkTarget(platform: NodeJS.Platform, arch: NodeJS.Architecture = process.arch): RtkTarget {
  if (platform === "darwin" && arch === "arm64") return { asset: "rtk-aarch64-apple-darwin.tar.gz", archiveKind: "tar.gz" };
  if (platform === "darwin" && arch === "x64") return { asset: "rtk-x86_64-apple-darwin.tar.gz", archiveKind: "tar.gz" };
  if (platform === "linux" && arch === "arm64") return { asset: "rtk-aarch64-unknown-linux-gnu.tar.gz", archiveKind: "tar.gz" };
  if (platform === "linux" && arch === "x64") return { asset: "rtk-x86_64-unknown-linux-musl.tar.gz", archiveKind: "tar.gz" };
  if (platform === "win32" && arch === "x64") return { asset: "rtk-x86_64-pc-windows-msvc.zip", archiveKind: "zip" };
  throw new Error(`Unsupported RTK platform/arch: ${platform}/${arch}`);
}

export function parseChecksumLine(checksums: string, assetName: string): string {
  const line = checksums.split(/\r?\n/).find((entry) => entry.trim().endsWith(assetName));
  const digest = line?.trim().split(/\s+/)[0];
  if (!digest || !/^[a-f0-9]{64}$/i.test(digest)) {
    throw new Error(`checksum for ${assetName} not found in checksums.txt`);
  }
  return digest.toLowerCase();
}

export function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function fetchLatestRtkTag(fetchImpl: typeof fetch = fetch): Promise<string> {
  const response = await fetchImpl(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "dont-waste" },
  });
  if (!response.ok) throw new Error(`GitHub releases/latest failed: ${response.status}`);
  const body = await response.json() as { tag_name?: unknown };
  if (typeof body.tag_name !== "string" || !body.tag_name) throw new Error("GitHub release response missing tag_name");
  return body.tag_name;
}

export type InstallRtkOptions = {
  platform?: NodeJS.Platform;
  arch?: NodeJS.Architecture;
  installDir?: string;
  tag?: string;
  fetchImpl?: typeof fetch;
  dryRun?: boolean;
};

export type InstallRtkResult = {
  tag: string;
  asset: string;
  binaryPath: string;
  checksum: string;
  dryRun: boolean;
};

export async function installRtkFromOfficialRelease(options: InstallRtkOptions = {}): Promise<InstallRtkResult> {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const fetchImpl = options.fetchImpl ?? fetch;
  const target = resolveRtkTarget(platform, arch);
  const tag = options.tag ?? await fetchLatestRtkTag(fetchImpl);
  const installDir = options.installDir ?? path.join(os.homedir(), ".local", "bin");
  const binaryName = platform === "win32" ? "rtk.exe" : "rtk";
  const binaryPath = path.join(installDir, binaryName);
  const archiveUrl = `https://github.com/${REPO}/releases/download/${tag}/${target.asset}`;
  const checksumsUrl = `https://github.com/${REPO}/releases/download/${tag}/checksums.txt`;

  if (options.dryRun) {
    return { tag, asset: target.asset, binaryPath, checksum: "(pending download)", dryRun: true };
  }

  const [archiveResponse, checksumsResponse] = await Promise.all([
    fetchImpl(archiveUrl, { headers: { "User-Agent": "dont-waste" } }),
    fetchImpl(checksumsUrl, { headers: { "User-Agent": "dont-waste" } }),
  ]);
  if (!archiveResponse.ok) throw new Error(`Failed to download ${archiveUrl}: ${archiveResponse.status}`);
  if (!checksumsResponse.ok) throw new Error(`Failed to download checksums.txt — refusing to install unverified binary (${checksumsResponse.status})`);

  const archive = Buffer.from(await archiveResponse.arrayBuffer());
  const expected = parseChecksumLine(await checksumsResponse.text(), target.asset);
  const actual = sha256(archive);
  if (expected !== actual) {
    throw new Error(`checksum mismatch! expected=${expected} actual=${actual} — refusing to install`);
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "dont-waste-rtk-"));
  try {
    const archivePath = path.join(tempDir, target.asset);
    await writeFile(archivePath, archive);
    if (target.archiveKind === "tar.gz") {
      await execa("tar", ["-xzf", archivePath, "-C", tempDir], { reject: true });
    } else {
      await execa("tar", ["-xf", archivePath, "-C", tempDir], { reject: true });
    }
    const extracted = path.join(tempDir, platform === "win32" ? "rtk.exe" : "rtk");
    await readFile(extracted);
    await mkdir(installDir, { recursive: true });
    await rename(extracted, binaryPath);
    if (platform !== "win32") await chmod(binaryPath, 0o755);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }

  return { tag, asset: target.asset, binaryPath, checksum: expected, dryRun: false };
}
