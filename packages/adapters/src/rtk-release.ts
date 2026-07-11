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
import { trackInFlight } from "@dont-waste/core";
import { execa } from "execa";

const REPO = "rtk-ai/rtk";
const FETCH_TIMEOUT_MS = 30_000;
const EXTRACT_TIMEOUT_MS = 60_000;
const EXTRACT_FORCE_KILL_MS = 5_000;

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

/** Compose an optional external AbortSignal with the fetch timeout. */
export async function fetchWithTimeout(
  url: string,
  fetchImpl: typeof fetch,
  init: RequestInit = {},
  externalSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const onExternalAbort = () => {
    controller.abort(externalSignal?.reason);
  };
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort(externalSignal.reason);
    else
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      if (externalSignal?.aborted) {
        throw new Error(`Aborted while fetching ${url}`);
      }
      throw new Error(`Timed out after ${FETCH_TIMEOUT_MS}ms fetching ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}

export async function fetchLatestRtkTag(
  fetchImpl: typeof fetch = fetch,
  abortSignal?: AbortSignal,
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
    abortSignal,
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
  abortSignal?: AbortSignal | undefined;
};

export type InstallRtkResult = {
  tag: string;
  asset: string;
  binaryPath: string;
  checksum: string;
  dryRun: boolean;
};

function extractOptions(abortSignal?: AbortSignal) {
  return {
    reject: true as const,
    timeout: EXTRACT_TIMEOUT_MS,
    forceKillAfterDelay: EXTRACT_FORCE_KILL_MS,
    ...(abortSignal ? { cancelSignal: abortSignal } : {}),
  };
}

async function runExtract(
  file: string,
  args: string[],
  abortSignal?: AbortSignal,
): Promise<void> {
  await trackInFlight(execa(file, args, extractOptions(abortSignal)));
}

async function readBodyWithSignal<T>(
  promise: Promise<T>,
  abortSignal?: AbortSignal,
): Promise<T> {
  if (!abortSignal) return promise;
  if (abortSignal.aborted) throw new Error("RTK release install aborted");
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(new Error("RTK release install aborted"));
    };
    abortSignal.addEventListener("abort", onAbort, { once: true });
    promise
      .then((val) => {
        if (abortSignal.aborted) {
          reject(new Error("RTK release install aborted"));
        } else {
          resolve(val);
        }
      })
      .catch(reject)
      .finally(() => {
        abortSignal.removeEventListener("abort", onAbort);
      });
  });
}

export async function installRtkFromOfficialRelease(
  options: InstallRtkOptions = {},
): Promise<InstallRtkResult> {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const fetchImpl = options.fetchImpl ?? fetch;
  const abortSignal = options.abortSignal;
  if (abortSignal?.aborted) throw new Error("RTK release install aborted");
  const target = resolveRtkTarget(platform, arch);
  const tag = options.tag ?? (await fetchLatestRtkTag(fetchImpl, abortSignal));
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
    fetchWithTimeout(
      archiveUrl,
      fetchImpl,
      { headers: { "User-Agent": "dont-waste" } },
      abortSignal,
    ),
    fetchWithTimeout(
      checksumsUrl,
      fetchImpl,
      { headers: { "User-Agent": "dont-waste" } },
      abortSignal,
    ),
  ]);
  if (!archiveResponse.ok)
    throw new Error(
      `Failed to download ${archiveUrl}: ${archiveResponse.status}`,
    );
  if (!checksumsResponse.ok)
    throw new Error(
      `Failed to download checksums.txt — refusing to install unverified binary (${checksumsResponse.status})`,
    );

  if (abortSignal?.aborted) throw new Error("RTK release install aborted");
  const archiveBuffer = await readBodyWithSignal(
    archiveResponse.arrayBuffer(),
    abortSignal,
  );
  if (abortSignal?.aborted) throw new Error("RTK release install aborted");
  const archive = Buffer.from(archiveBuffer);

  const checksumsText = await readBodyWithSignal(
    checksumsResponse.text(),
    abortSignal,
  );
  if (abortSignal?.aborted) throw new Error("RTK release install aborted");
  const expected = parseChecksumLine(checksumsText, target.asset);
  const actual = sha256(archive);
  if (expected !== actual) {
    throw new Error(
      `checksum mismatch! expected=${expected} actual=${actual} — refusing to install`,
    );
  }

  if (abortSignal?.aborted) throw new Error("RTK release install aborted");

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "dont-waste-rtk-"));
  try {
    const archivePath = path.join(tempDir, target.asset);
    if (abortSignal?.aborted) throw new Error("RTK release install aborted");
    await writeFile(archivePath, archive);
    if (abortSignal?.aborted) throw new Error("RTK release install aborted");
    if (target.archiveKind === "tar.gz") {
      await runExtract(
        "tar",
        ["-xzf", archivePath, "-C", tempDir],
        abortSignal,
      );
    } else if (platform === "win32") {
      // Prefer tar (available on modern Windows); fall back to PowerShell Expand-Archive.
      try {
        await runExtract(
          "tar",
          ["-xf", archivePath, "-C", tempDir],
          abortSignal,
        );
      } catch (err) {
        if (abortSignal?.aborted) throw err;
        await runExtract(
          "powershell",
          [
            "-NoProfile",
            "-Command",
            `Expand-Archive -LiteralPath '${archivePath.replaceAll("'", "''")}' -DestinationPath '${tempDir.replaceAll("'", "''")}' -Force`,
          ],
          abortSignal,
        );
      }
    } else {
      await runExtract(
        "unzip",
        ["-o", archivePath, "-d", tempDir],
        abortSignal,
      );
    }
    if (abortSignal?.aborted) throw new Error("RTK release install aborted");
    const extracted = await findExtractedBinary(tempDir, binaryName);
    if (abortSignal?.aborted) throw new Error("RTK release install aborted");
    await mkdir(installDir, { recursive: true });
    if (abortSignal?.aborted) throw new Error("RTK release install aborted");
    await rename(extracted, binaryPath);
    if (abortSignal?.aborted) throw new Error("RTK release install aborted");
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
