# Handoff — Don’t Waste

Data do handoff: 2026-07-10
Branch: `antigravity`
Checkout: `/mnt/c/Users/Lucas/orca/projects/dont_waste`

## Objetivo

Orquestrador local-first que integra Headroom, RTK, Caveman e Ponytail para Codex, Claude Code, Gemini CLI, Copilot CLI, Antigravity CLI, OpenCode e Pi.

## Estado atual (implementado)

### Monorepo e distribuição

- Workspace pnpm + TypeScript estrito (`apps/cli`, `apps/dashboard`, `packages/*`).
- Binário `dont-waste` via tsup; pacotes internos exportam `dist/`.
- Contratos de distribuição cobertos por testes (`bin`/`files`/`exports`, shebang tsup, install scripts Node 22+, Docker read-only data).
- CI matriz Ubuntu/macOS/Windows: lint (Prettier) → typecheck → test → build → smoke CLI não destrutivo.
- Docker: `docker/Dockerfile` + `compose.yaml`; `scripts/docker-smoke.sh` (skip se daemon ausente).

### Catálogo, core, telemetria

- Matriz declarativa de tools/agentes/modos.
- `config.json`/`state.json`, snapshots/rollback, `DONT_WASTE_DATA_DIR`.
- SQLite local (`node:sqlite`) com events/imports/operations/projects/sessions.
- Fixtures sanitizadas; importadores measured/estimated/holdout/benchmark-reference.
- Dedupe por `overlapKey`; Caveman stats só via `DONT_WASTE_CAVEMAN_STATS_FILE` (sem prompts/outputs).

### Adaptadores

- **RTK / Headroom:** endurecidos (release SHA-256, MCP merge, fallbacks de collect).
- **Headroom advanced (verificável):** `outputShaper` → `HEADROOM_OUTPUT_SHAPER=1`; `ccrTtl` → `HEADROOM_CCR_TTL_SECONDS=7200` em MCP marker-owned; `learnVerbosity` → comando opcional `headroom learn --verbosity` sem `--apply`.
- **MCP-shrink:** pending/unsupported (sem flag upstream; compress via `headroom mcp serve`).
- **Caveman:** markers + cavecrew/compress marker-owned.
- **Ponytail:** uninstall ampliado (incl. Copilot/Antigravity).

### CLI / Dashboard / TUI

- Menu TUI; dashboard listen-first; plan summary por agente (paths, restart, compatibility, reversal).
- SPA estruturada (Tools/Config/Diagnostics); filtros; agregação diária/semanal; Recharts lazy.

## Verificações

- Rodar após integração residual: `pnpm lint`, `typecheck`, `test`, `build`, `git diff --check`, smoke CLI dry-run.

## Pendências reais

1. **Playwright** — sem infra no monorepo.
2. **Docker daemon** — smoke script existe; validação real ainda indisponível neste WSL.
3. **npm publish / site** `dont-waste.dev` — fora de escopo até release.
4. **MCP-shrink** — sem contrato upstream discreto (compressão MCP já vem com `headroom mcp serve`).
5. Controles ainda fora do TUI: CCR/TTL via wrap/proxy shell env fora de MCP; `learn --verbosity --apply` permanece manual.

## Regras

- Não rodar `init --yes` nem installers reais contra HOME do usuário.
- Usar `HOME` + `DONT_WASTE_DATA_DIR` temporários.
- Preservar subcomandos; commits pequenos por fatia.
