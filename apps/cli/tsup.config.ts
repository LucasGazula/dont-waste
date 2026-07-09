import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  // The local packages publish normal ESM artifacts. Keeping them external
  // avoids rewriting node:sqlite or Fastify's CommonJS dynamic requires.
  external: [/^@dont-waste\//],
  banner: { js: "#!/usr/bin/env node" },
});
