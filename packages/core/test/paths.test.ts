import { describe, expect, it } from "vitest";
import { getDataPaths } from "../src/index.js";

describe("platform data paths", () => {
  it("uses the operating system data directory convention", () => {
    expect(getDataPaths("linux", { HOME: "/home/alex" }).root).toBe(
      "/home/alex/.local/share/dont-waste",
    );
    expect(getDataPaths("darwin", { HOME: "/Users/alex" }).root).toBe(
      "/Users/alex/Library/Application Support/dont-waste",
    );
    expect(
      getDataPaths("win32", { APPDATA: "C:\\Users\\Alex\\AppData\\Roaming" })
        .root,
    ).toBe("C:\\Users\\Alex\\AppData\\Roaming/dont-waste");
  });

  it("honours an explicit data directory on every platform", () => {
    expect(
      getDataPaths("win32", { DONT_WASTE_DATA_DIR: "D:\\dont-waste" }).database,
    ).toBe("D:\\dont-waste/dont-waste.sqlite");
  });
});
