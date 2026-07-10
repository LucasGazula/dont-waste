import os from "node:os";
import path from "node:path";

export type DataPaths = {
  root: string;
  config: string;
  state: string;
  database: string;
  backups: string;
  logs: string;
};

export function getDataPaths(
  platform = process.platform,
  env = process.env,
): DataPaths {
  const userHome = env.HOME ?? env.USERPROFILE ?? os.homedir();
  const root =
    env.DONT_WASTE_DATA_DIR ??
    (platform === "darwin"
      ? path.join(userHome, "Library", "Application Support", "dont-waste")
      : platform === "win32"
        ? path.join(
            env.APPDATA ?? path.join(userHome, "AppData", "Roaming"),
            "dont-waste",
          )
        : path.join(
            env.XDG_DATA_HOME ?? path.join(userHome, ".local", "share"),
            "dont-waste",
          ));
  return {
    root,
    config: path.join(root, "config.json"),
    state: path.join(root, "state.json"),
    database: path.join(root, "dont-waste.sqlite"),
    backups: path.join(root, "backups"),
    logs: path.join(root, "logs"),
  };
}

export function expandHome(value: string, homedir = os.homedir()): string {
  return value === "~"
    ? homedir
    : value.startsWith("~/")
      ? path.join(homedir, value.slice(2))
      : value;
}
