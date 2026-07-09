# Don’t Waste

Don’t Waste is a local-first orchestrator for the upstream token-reduction tools [Headroom](https://github.com/headroomlabs-ai/headroom), [RTK](https://github.com/rtk-ai/rtk), [Caveman](https://github.com/JuliusBrussee/caveman), and [Ponytail](https://github.com/DietrichGebert/ponytail).

It supports Codex, Claude Code, Gemini CLI, GitHub Copilot CLI, Antigravity CLI, OpenCode, and Pi through explicit adapters. It stores only local installation state and token metrics; it neither reads credentials nor saves prompts, tool output, or conversations.

## Run locally

```sh
corepack enable
pnpm install
pnpm --filter dont-waste dev -- init --dry-run
pnpm --filter dont-waste dev -- init
```

The CLI always shows the upstream commands and affected configuration paths before making changes. Use `--yes` only for unattended automation.

```sh
dont-waste status
dont-waste doctor
dont-waste collect
dont-waste dashboard
dont-waste update
dont-waste rollback <operation-id>
dont-waste uninstall
```

The local data directory is `~/.local/share/dont-waste` on Linux, `~/Library/Application Support/dont-waste` on macOS, and `%APPDATA%\dont-waste` on Windows. Set `DONT_WASTE_DATA_DIR` to use another location.

## Measurement policy

RTK and Headroom measurements are imported only when their upstream commands provide observed before/after values. If both transformed the same content flow, the measured total keeps only the earliest source observation. Caveman output savings are estimates and never enter the measured total. Ponytail has no operational token telemetry and appears as unavailable instead of receiving fabricated savings.

## Docker dashboard

The container only visualizes already-collected local data; it never installs or configures host agents.

```sh
export DONT_WASTE_HOST_DATA_DIR="$HOME/.local/share/dont-waste"
docker compose -f docker/compose.yaml run --service-ports --rm dashboard
```
