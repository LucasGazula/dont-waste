# Don’t Waste

Don’t Waste is a local-first orchestrator for the upstream token-reduction tools [Headroom](https://github.com/headroomlabs-ai/headroom), [RTK](https://github.com/rtk-ai/rtk), [Caveman](https://github.com/JuliusBrussee/caveman), and [Ponytail](https://github.com/DietrichGebert/ponytail).

It supports Codex, Claude Code, Gemini CLI, GitHub Copilot CLI, Antigravity CLI, OpenCode, and Pi through explicit adapters. It stores only local installation state and token metrics; it neither reads credentials nor saves prompts, tool output, or conversations.

## Run locally

```sh
corepack enable
pnpm install
pnpm --filter dont-waste dev
pnpm --filter dont-waste dev -- init --dry-run
pnpm --filter dont-waste dev -- init
```

With no arguments in a real terminal, Don’t Waste opens an interactive menu (Setup, Status, Doctor, Collect, Open dashboard, Updates, Uninstall). You can also run `dont-waste menu`. Direct subcommands still work.

The CLI always shows the upstream commands and affected configuration paths before making changes. Use `--yes` only for unattended automation.

```sh
dont-waste menu
dont-waste status
dont-waste doctor
dont-waste collect
dont-waste dashboard
dont-waste update
dont-waste rollback <operation-id>
dont-waste uninstall
```

`dont-waste dashboard` starts the local server, prints a usable URL, and keeps running until Ctrl+C. Metrics collection runs in the background after listen. Build `apps/dashboard` (or set `DONT_WASTE_DASHBOARD_ASSETS`) so the SPA is served; otherwise the API-only page is shown.

The local data directory is `~/.local/share/dont-waste` on Linux, `~/Library/Application Support/dont-waste` on macOS, and `%APPDATA%\dont-waste` on Windows. Set `DONT_WASTE_DATA_DIR` to use another location.

## Measurement policy

RTK and Headroom measurements are imported only when their upstream commands provide observed before/after values. If both transformed the same content flow, the measured total keeps only the earliest source observation. Caveman output savings are estimates and never enter the measured total. Ponytail has no operational token telemetry and appears as unavailable instead of receiving fabricated savings.

## Docker dashboard

The container only visualizes already-collected local data; it never installs or configures host agents.

```sh
export DONT_WASTE_HOST_DATA_DIR="$HOME/.local/share/dont-waste"
docker compose -f docker/compose.yaml run --service-ports --rm dashboard
```

Build the image alone with:

```sh
docker build -f docker/Dockerfile -t dont-waste .
```

## Distribution

The publishable CLI package is `dont-waste` (`apps/cli`): `bin` → `./dist/main.js`, `files` → `["dist"]`. Workspace packages export `./dist/index.js`. Optional bootstrap scripts in `scripts/` require Node.js 22+ and run `npm install --global dont-waste@latest` (npm publish / site are separate).

CI runs Prettier, typecheck, tests, build, then a non-destructive CLI smoke (`--help`, `init`/`update`/`collect --dry-run`, dashboard dry-run) on Ubuntu, macOS, and Windows.
