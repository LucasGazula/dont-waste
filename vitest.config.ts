import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@dont-waste/catalog": path.resolve("packages/catalog/src/index.ts"),
      "@dont-waste/core": path.resolve("packages/core/src/index.ts"),
      "@dont-waste/telemetry": path.resolve("packages/telemetry/src/index.ts"),
      "@dont-waste/adapters": path.resolve("packages/adapters/src/index.ts"),
      "@dont-waste/dashboard-api": path.resolve(
        "packages/dashboard-api/src/index.ts",
      ),
      "@dont-waste/test-fixtures": path.resolve(
        "packages/test-fixtures/src/index.ts",
      ),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    coverage: { provider: "v8", reporter: ["text", "html"] },
  },
});
