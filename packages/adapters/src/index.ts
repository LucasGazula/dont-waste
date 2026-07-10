export * from "./activation.js";
export * from "./advanced-controls.js";
export * from "./agents.js";
export * from "./caveman.js";
export * from "./config-tools.js";
export * from "./headroom.js";
export * from "./ponytail.js";
export * from "./rtk.js";
export * from "./types.js";

import type { ToolId } from "@dont-waste/catalog";
import { CavemanAdapter } from "./caveman.js";
import { HeadroomAdapter } from "./headroom.js";
import { PonytailAdapter } from "./ponytail.js";
import { RtkAdapter } from "./rtk.js";
import type { ToolAdapter } from "./types.js";

export function createAdapters(): Record<ToolId, ToolAdapter> {
  return {
    headroom: new HeadroomAdapter(),
    rtk: new RtkAdapter(),
    caveman: new CavemanAdapter(),
    ponytail: new PonytailAdapter(),
  };
}
