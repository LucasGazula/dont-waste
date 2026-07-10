import type { ToolId } from "@dont-waste/catalog";

export type ReleaseInfo = {
  tool: ToolId;
  latest?: string | undefined;
  url: string;
  error?: string | undefined;
};

export type InstalledInfo = {
  tool: ToolId;
  installed?: string | undefined;
  detected: boolean;
};

export type UpdateComparison = {
  tool: ToolId;
  installed?: string | undefined;
  latest?: string | undefined;
  url: string;
  status: "up-to-date" | "update-available" | "not-installed" | "unknown" | "error";
  error?: string | undefined;
};

/** Normalize GitHub tags and CLI version strings for loose equality. */
export function normalizeVersion(version: string | undefined): string | undefined {
  if (!version) return undefined;
  const cleaned = version.trim().replace(/^v/i, "").replace(/^[^\d]*/, "").split(/\s+/)[0];
  return cleaned || undefined;
}

export function compareVersions(installed: string | undefined, latest: string | undefined): "equal" | "different" | "unknown" {
  const left = normalizeVersion(installed);
  const right = normalizeVersion(latest);
  if (!left || !right) return "unknown";
  return left === right ? "equal" : "different";
}

export function compareUpdates(installed: InstalledInfo[], releases: ReleaseInfo[]): UpdateComparison[] {
  return releases.map((release) => {
    const local = installed.find((item) => item.tool === release.tool);
    if (release.error) {
      return { tool: release.tool, installed: local?.installed, latest: release.latest, url: release.url, status: "error", error: release.error };
    }
    if (!local?.detected) {
      return { tool: release.tool, installed: undefined, latest: release.latest, url: release.url, status: "not-installed" };
    }
    const relation = compareVersions(local.installed, release.latest);
    if (relation === "equal") return { tool: release.tool, installed: local.installed, latest: release.latest, url: release.url, status: "up-to-date" };
    if (relation === "different") return { tool: release.tool, installed: local.installed, latest: release.latest, url: release.url, status: "update-available" };
    return { tool: release.tool, installed: local.installed, latest: release.latest, url: release.url, status: "unknown" };
  });
}

export function toolsNeedingUpdate(comparisons: UpdateComparison[]): ToolId[] {
  // "unknown" means we cannot prove an upgrade is needed (e.g. plugin-only tools
  // without a recorded upstream version). Do not force a reinstall plan for those.
  return comparisons
    .filter((item) => item.status === "update-available" || item.status === "not-installed")
    .map((item) => item.tool);
}
