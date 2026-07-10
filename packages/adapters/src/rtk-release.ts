import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";

const REPO = "rtk-ai/rtk";
const FETCH_TIMEOUT_MS = 30_000;

export type RtkTarget = {
  asset: string;
  archiveKind: "tar.gz" | "zip";
};

export function resolveRtkTarget(
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture = process.arch,
): RtkTarget {
  if (platform === "darwin" && arch === "arm64")
    return { asset: "rtk-aarch64-apple-darwin.tar.gz", archiveKind: "tar.gz" };
  if (platform === "darwin" && arch === "x64")
    return { asset: "rtk-x86_64-apple-darwin.tar.gz", archiveKind: "tar.gz" };
  if (platform === "linux" && arch === "arm64")
    return {
      asset: "rtk-aarch64-unknown-linux-gnu.tar.gz",
      archiveKind: "tar.gz",
    };
  if (platform === "linux" && arch === "x64")
    return {
      asset: "rtk-x86_64-unknown-linux-musl.tar.gz",
      archiveKind: "tar.gz",
    };
  if (platform === "win32" && arch === "x64")
    return { asset: "rtk-x86_64-pc-windows-msvc.zip", archiveKind: "zip" };
  throw new Error(`Unsupported RTK platform/arch: ${platform}/${arch}`);
}

export function parseChecksumLine(
  checksums: string,
  assetName: string,
): string {
  const line = checksums
    .split(/\r?\n/)
    .find((entry) => entry.trim().endsWith(assetName));
  const digest = line?.trim().split(/\s+/)[0];
  if (!digest || !/^[a-f0-9]{64}$/i.test(digest)) {
    throw new Error(`checksum for ${assetName} not found in checksums.txt`);
  }
  return digest.toLowerCase();
}

export function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

async function fetchWithTimeout(
  url: string,
  fetchImpl: typeof fetch,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Timed out after ${FETCH_TIMEOUT_MS}ms fetching ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchLatestRtkTag(
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchWithTimeout(
    `https://api.github.com/repos/${REPO}/releases/latest`,
    fetchImpl,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "dont-waste",
      },
    },
  );
  if (!response.ok)
    throw new Error(`GitHub releases/latest failed: ${response.status}`);
  const body = (await response.json()) as { tag_name?: unknown };
  if (typeof body.tag_name !== "string" || !body.tag_name)
    throw new Error("GitHub release response missing tag_name");
  return body.tag_name;
}

/** Walk the extract tree for the RTK binary (archives may nest the file). */
export async function findExtractedBinary(
  root: string,
  binaryName: string,
): Promise<string> {
  const direct = path.join(root, binaryName);
  try {
    await readFile(direct);
    return direct;
  } catch {
    /* search recursively */
  }
  const stack = [root];
  while (stack.length) {
    const current = stack.pop()!;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name === binaryName) return full;
    }
  }
  throw new Error(`Extracted archive did not contain ${binaryName}`);
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

export async function installRtkFromOfficialRelease(
  options: InstallRtkOptions = {},
): Promise<InstallRtkResult> {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const fetchImpl = options.fetchImpl ?? fetch;
  const target = resolveRtkTarget(platform, arch);
  const tag = options.tag ?? (await fetchLatestRtkTag(fetchImpl));
  const installDir =
    options.installDir ?? path.join(os.homedir(), ".local", "bin");
  const binaryName = platform === "win32" ? "rtk.exe" : "rtk";
  const binaryPath = path.join(installDir, binaryName);
  const archiveUrl = `https://github.com/${REPO}/releases/download/${tag}/${target.asset}`;
  const checksumsUrl = `https://github.com/${REPO}/releases/download/${tag}/checksums.txt`;

  if (options.dryRun) {
    return {
      tag,
      asset: target.asset,
      binaryPath,
      checksum: "(pending download)",
      dryRun: true,
    };
  }

  const [archiveResponse, checksumsResponse] = await Promise.all([
    fetchWithTimeout(archiveUrl, fetchImpl, {
      headers: { "User-Agent": "dont-waste" },
    }),
    fetchWithTimeout(checksumsUrl, fetchImpl, {
      headers: { "User-Agent": "dont-waste" },
    }),
  ]);
  if (!archiveResponse.ok)
    throw new Error(
      `Failed to download ${archiveUrl}: ${archiveResponse.status}`,
    );
  if (!checksumsResponse.ok)
    throw new Error(
      `Failed to download checksums.txt — refusing to install unverified binary (${checksumsResponse.status})`,
    );

  const archive = Buffer.from(await archiveResponse.arrayBuffer());
  const expected = parseChecksumLine(
    await checksumsResponse.text(),
    target.asset,
  );
  const actual = sha256(archive);
  if (expected !== actual) {
    throw new Error(
      `checksum mismatch! expected=${expected} actual=${actual} — refusing to install`,
    );
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "dont-waste-rtk-"));
  try {
    const archivePath = path.join(tempDir, target.asset);
    await writeFile(archivePath, archive);
    if (target.archiveKind === "tar.gz") {
      await execa("tar", ["-xzf", archivePath, "-C", tempDir], {
        reject: true,
        timeout: 60_000,
        forceKillAfterDelay: 5_000,
      });
    } else if (platform === "win32") {
      // Prefer tar (available on modern Windows); fall back to PowerShell Expand-Archive.
      try {
        await execa("tar", ["-xf", archivePath, "-C", tempDir], {
          reject: true,
          timeout: 60_000,
          forceKillAfterDelay: 5_000,
        });
      } catch {
        await execa(
          "powershell",
          [
            "-NoProfile",
            "-Command",
            `Expand-Archive -LiteralPath '${archivePath.replaceAll("'", "''")}' -DestinationPath '${tempDir.replaceAll("'", "''")}' -Force`,
          ],
          {
            reject: true,
            timeout: 60_000,
            forceKillAfterDelay: 5_000,
          },
        );
      }
    } else {
      await execa("unzip", ["-o", archivePath, "-d", tempDir], {
        reject: true,
        timeout: 60_000,
        forceKillAfterDelay: 5_000,
      });
    }
    const extracted = await findExtractedBinary(tempDir, binaryName);
    await mkdir(installDir, { recursive: true });
    await rename(extracted, binaryPath);
    if (platform !== "win32") await chmod(binaryPath, 0o755);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }

  return {
    tag,
    asset: target.asset,
    binaryPath,
    checksum: expected,
    dryRun: false,
  };
}
