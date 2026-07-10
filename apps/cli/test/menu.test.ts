import { describe, expect, it } from "vitest";
import { mainMenuOptions, menuHelpText, shouldOpenMainMenu } from "../src/menu.js";

describe("main menu helpers", () => {
  it("lists setup through uninstall actions", () => {
    const values = mainMenuOptions.map((option) => option.value);
    expect(values).toEqual([
      "init",
      "status",
      "doctor",
      "collect",
      "dashboard",
      "update",
      "uninstall",
      "exit",
    ]);
    expect(mainMenuOptions.find((option) => option.value === "dashboard")?.label).toContain("dashboard");
    expect(mainMenuOptions.find((option) => option.value === "uninstall")?.label).toBe("Uninstall");
  });

  it("opens only for bare interactive invocations", () => {
    const tty = { stdinIsTTY: true, stdoutIsTTY: true };
    expect(shouldOpenMainMenu(["node", "dont-waste"], tty)).toBe(true);
    expect(shouldOpenMainMenu(["node", "dont-waste", "--json"], tty)).toBe(false);
    expect(shouldOpenMainMenu(["node", "dont-waste", "init"], tty)).toBe(false);
    expect(shouldOpenMainMenu(["node", "dont-waste", "menu"], tty)).toBe(false);
    expect(shouldOpenMainMenu(["node", "dont-waste", "--help"], tty)).toBe(false);
    expect(shouldOpenMainMenu(["node", "dont-waste"], { stdinIsTTY: false, stdoutIsTTY: true })).toBe(false);
  });

  it("documents the menu entrypoint", () => {
    expect(menuHelpText()).toContain("dont-waste menu");
    expect(menuHelpText()).toContain("dashboard");
    expect(menuHelpText()).toContain("uninstall");
  });
});
