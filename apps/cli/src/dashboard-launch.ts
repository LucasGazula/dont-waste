import path from "node:path";

export type BrowserOpenCommand = { command: string; args: string[] };

export function resolveDashboardStaticDir(options: {
  cwd: string;
  envAssets?: string | undefined;
  existsSync: (candidate: string) => boolean;
}): string | undefined {
  const candidates = [
    options.envAssets ? path.resolve(options.envAssets) : undefined,
    path.resolve(options.cwd, "apps/dashboard/dist"),
    path.resolve(options.cwd, "../dashboard/dist"),
    path.resolve(options.cwd, "../../apps/dashboard/dist"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => options.existsSync(candidate));
}

export function formatDashboardReady(url: string, staticAssets: boolean): string {
  const lines = [
    `Dashboard listening at ${url}`,
    staticAssets
      ? "Serving the local SPA from the built dashboard assets."
      : "API only — build apps/dashboard (or set DONT_WASTE_DASHBOARD_ASSETS) to serve the SPA.",
    "Press Ctrl+C to stop.",
  ];
  return lines.join("\n");
}

export function browserOpenCommand(platform: NodeJS.Platform, url: string): BrowserOpenCommand {
  if (platform === "win32") return { command: "cmd", args: ["/c", "start", "", url] };
  if (platform === "darwin") return { command: "open", args: [url] };
  return { command: "xdg-open", args: [url] };
}
