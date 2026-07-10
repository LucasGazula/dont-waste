import path from "node:path";
import { describe, expect, it } from "vitest";
import { browserOpenCommand, formatDashboardReady, resolveDashboardStaticDir } from "../src/dashboard-launch.js";

describe("dashboard launch helpers", () => {
  it("prefers DONT_WASTE_DASHBOARD_ASSETS when present", () => {
    const chosen = resolveDashboardStaticDir({
      cwd: "/repo",
      envAssets: "/custom/assets",
      existsSync: (candidate) => candidate === path.resolve("/custom/assets"),
    });
    expect(chosen).toBe(path.resolve("/custom/assets"));
  });

  it("falls back to apps/dashboard/dist under cwd", () => {
    const expected = path.resolve("/repo", "apps/dashboard/dist");
    const chosen = resolveDashboardStaticDir({
      cwd: "/repo",
      existsSync: (candidate) => candidate === expected,
    });
    expect(chosen).toBe(expected);
  });

  it("formats a clear ready message with the URL", () => {
    const text = formatDashboardReady("http://127.0.0.1:4310", true);
    expect(text).toContain("http://127.0.0.1:4310");
    expect(text).toContain("Ctrl+C");
    expect(formatDashboardReady("http://127.0.0.1:4310", false)).toContain("API only");
  });

  it("builds a platform browser opener", () => {
    expect(browserOpenCommand("win32", "http://x")).toEqual({ command: "cmd", args: ["/c", "start", "", "http://x"] });
    expect(browserOpenCommand("darwin", "http://x")).toEqual({ command: "open", args: ["http://x"] });
    expect(browserOpenCommand("linux", "http://x")).toEqual({ command: "xdg-open", args: ["http://x"] });
  });
});
