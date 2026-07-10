import { describe, expect, it } from "vitest";
import { shouldActivateIntegration } from "../src/activation.js";
import type { HealthCheck, InstallResult } from "../src/types.js";

const pass: HealthCheck = { id: "ok", status: "pass", message: "ok" };
const warn: HealthCheck = { id: "w", status: "warn", message: "warn" };
const fail: HealthCheck = { id: "f", status: "fail", message: "fail" };

function install(overrides: Partial<InstallResult> = {}): InstallResult {
  return {
    succeeded: true,
    executed: [],
    skipped: [],
    errors: [],
    ...overrides,
  };
}

describe("shouldActivateIntegration", () => {
  it("activates only when every check passes and install succeeded", () => {
    expect(
      shouldActivateIntegration({
        profile: "balanced",
        checks: [pass],
        install: install(),
      }),
    ).toBe(true);
  });

  it("refuses install-only, warnings, failures, and required interactive skips", () => {
    expect(
      shouldActivateIntegration({
        profile: "install-only",
        checks: [pass],
        install: install(),
      }),
    ).toBe(false);
    expect(
      shouldActivateIntegration({
        profile: "balanced",
        checks: [pass, warn],
        install: install(),
      }),
    ).toBe(false);
    expect(
      shouldActivateIntegration({
        profile: "balanced",
        checks: [fail],
        install: install(),
      }),
    ).toBe(false);
    expect(
      shouldActivateIntegration({
        profile: "balanced",
        checks: [pass],
        install: install({
          skipped: [
            {
              command: "codex",
              args: [],
              label: "trust hooks",
              interactive: true,
            },
          ],
        }),
      }),
    ).toBe(false);
  });

  it("allows optional interactive skips such as Headroom wrap", () => {
    expect(
      shouldActivateIntegration({
        profile: "balanced",
        checks: [pass],
        install: install({
          skipped: [
            {
              command: "headroom",
              args: ["wrap", "codex"],
              label: "wrap",
              interactive: true,
              optional: true,
            },
          ],
        }),
      }),
    ).toBe(true);
  });
});
