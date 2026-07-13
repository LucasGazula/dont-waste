import type { HealthCheck, InstallResult } from "./types.js";

/** Activate only when install succeeded, required checks pass, and no required interactive step was skipped. */
export function shouldActivateIntegration(input: {
  profile: string;
  checks: HealthCheck[];
  install: InstallResult;
}): boolean {
  if (input.profile === "install-only") return false;
  if (!input.install.succeeded) return false;
  if (
    input.checks.some(
      (check) => check.blocksActivation !== false && check.status !== "pass",
    )
  )
    return false;
  const blockingSkipped = input.install.skipped.filter(
    (command) => command.interactive && !command.optional,
  );
  return blockingSkipped.length === 0;
}
