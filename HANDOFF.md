# Handoff — Don’t Waste

Handoff date: 2026-07-15  
Branch: `main`  
Checkout: `/mnt/c/Users/Lucas/orca/projects/dont_waste`

## Current status (2026-07-15)

**Codex under Orca is user-verified working** for Headroom MCP (`/mcp` shows `headroom`) and
Ponytail (appears as a skill). Caveman was already visible.

Root cause and durable fix: Orca merges system `~/.codex/config.toml` into
`…/codex-runtime-home/home`, preserving only managed `hooks.state` / `projects`. MCP and
plugin entries written only to the managed home are wiped on sync. Don’t Waste now mirrors
Codex Headroom MCP into system `~/.codex` when `CODEX_HOME` is Orca-managed; orphan Headroom
markers and orphan Ponytail marketplace dirs are recovered automatically.

Full write-up: [`docs/codex-orca-dual-home.md`](docs/codex-orca-dual-home.md).  
OKF second brain: `/mnt/d/Users/Lucas/Documentos/OKF` (especially `project/current-state.md`,
incident DW-006).

### Adapter changes in this slice

- `packages/adapters/src/mcp.ts` — orphan marker repair; `resolveCodexHomes` system mirror
- `packages/adapters/src/ponytail.ts` — orphan marketplace `remove` then re-register
- `packages/adapters/src/runtime.ts` — auth + Orca-home diagnostic warnings
- Tests: `packages/adapters/test/mcp.test.ts`, `ponytail.test.ts`

### Objective

Orquestrador local-first que integra Headroom, RTK, Caveman e Ponytail para Codex, Claude Code, Copilot CLI, Antigravity CLI, OpenCode e Pi.

Documentação de utilizador: [`README.md`](README.md). Comparação com upstreams (sem paridade total): [`docs/upstream-capability-audit.md`](docs/upstream-capability-audit.md).

## Estado atual (implementado)

### Monorepo e distribuição

- Workspace pnpm + TypeScript estrito (`apps/cli`, `apps/dashboard`, `packages/*`).
- Binário `dont-waste` via tsup; pacotes internos exportam `dist/`.
- Contratos de distribuição cobertos por testes (`bin`/`files`/`exports`, shebang tsup, install scripts Node 22+, Docker read-only data).
- CI matriz Ubuntu/macOS/Windows: lint (Prettier) → typecheck → test → build → smoke CLI não destrutivo.
- Docker: `docker/Dockerfile` + `compose.yaml`; `scripts/docker-smoke.sh` (skip se daemon ausente).
- Bootstrap local: `scripts/install.sh` / `scripts/install.ps1` (`--dry-run` / `-DryRun`, shim reversível em PREFIX; sem init/agentes; sem npm publish).

### Catálogo, core, telemetria

- Matriz declarativa de tools/agentes/modos.
- `config.json`/`state.json`, snapshots/rollback, `DONT_WASTE_DATA_DIR`.
- SQLite local (`node:sqlite`) com events/imports/operations/projects/sessions.
- Fixtures sanitizadas; importadores measured/estimated/holdout/benchmark-reference.
- Dedupe por `overlapKey`; Caveman stats só via `DONT_WASTE_CAVEMAN_STATS_FILE` (sem prompts/outputs).

### Adaptadores

- **RTK / Headroom:** endurecidos (release SHA-256, MCP merge, fallbacks de collect).
- **Headroom advanced (verificável):** `outputShaper` → `HEADROOM_OUTPUT_SHAPER=1`; `ccrTtl` → `HEADROOM_CCR_TTL_SECONDS=7200` em MCP marker-owned.
- **Codex / Orca:** MCP mirrored to system `~/.codex` when `CODEX_HOME` is managed; see `docs/codex-orca-dual-home.md`.
- **Pending/unsupported:** `learn --verbosity` (privacidade — não minerar transcripts); MCP-shrink (sem flag/comando verificado que garanta binário + mcp.json); TTL temporal RTK (RTK usa size/LRU, não TTL de tempo).
- **Caveman:** markers + cavecrew/compress marker-owned; skill files survive Orca config merge.
- **Ponytail:** orphan marketplace recovery via native `marketplace remove`; uninstall ampliado (incl. Copilot/Antigravity).

### CLI / Dashboard / TUI

- Menu TUI; dashboard listen-first; plan summary por agente (paths, restart, compatibility, reversal).
- SPA estruturada (Tools/Config/Diagnostics); filtros; agregação diária/semanal; Recharts lazy.

## Verificações

- Codex Orca TUI (2026-07-15): Headroom in `/mcp`; Ponytail skill visible; Caveman visible.
- Adapter focused tests for MCP + Ponytail dual-home / orphan recovery.
- Comandos: `pnpm lint`, `typecheck`, `test`, `build`, `git diff --check`, smoke CLI com `HOME`/`DONT_WASTE_DATA_DIR` temporários.

## Pendências reais

1. **Playwright** — sem infra no monorepo.
2. **Docker daemon** — smoke script existe; validação real ainda indisponível neste WSL.
3. **npm publish / site** `dont-waste.dev` — fora de escopo até release.
4. **CCR manual** — env CCR via wrap/proxy shell fora de MCP permanece manual (MCP marker-owned já cobre `ccrTtl` quando habilitado).
5. **Auto-mirror Ponytail marketplace/plugin into system `~/.codex`** — Headroom MCP is mirrored; Ponytail still relies on install commands honouring `CODEX_HOME` / operator repair of system home when Orca wipe recurs.

## Regras

- Não rodar `init --yes` nem installers reais contra HOME do usuário.
- Usar `HOME` + `DONT_WASTE_DATA_DIR` temporários.
- Preservar subcomandos; commits pequenos por fatia.
- For Orca Codex: configure system `~/.codex` as well as managed `CODEX_HOME`; close all Codex TUIs before mutating config; accept only a fresh session.
