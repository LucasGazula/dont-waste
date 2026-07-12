# Handoff — Don’t Waste

Data do handoff: 2026-07-10
Branch: `antigravity`
Checkout: /path/to/dont_waste

## Objetivo

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
- **Pending/unsupported:** `learn --verbosity` (privacidade — não minerar transcripts); MCP-shrink (sem flag/comando verificado que garanta binário + mcp.json); TTL temporal RTK (RTK usa size/LRU, não TTL de tempo).
- **Caveman:** markers + cavecrew/compress marker-owned.
- **Ponytail:** uninstall ampliado (incl. Copilot/Antigravity).

### CLI / Dashboard / TUI

- Menu TUI; dashboard listen-first; plan summary por agente (paths, restart, compatibility, reversal).
- SPA estruturada (Tools/Config/Diagnostics); filtros; agregação diária/semanal; Recharts lazy.

## Verificações

- Release audit em `2f1c29b`: HANDOFF ↔ `advanced-controls.ts` consistente (só `outputShaper`/`ccrTtl` em MCP marker-owned; learn/mcp-shrink/RTK TTL pending).
- Comandos: `pnpm lint`, `typecheck`, `test`, `build`, `git diff --check`, smoke CLI com `HOME`/`DONT_WASTE_DATA_DIR` temporários.

## Pendências reais

1. **Playwright** — sem infra no monorepo.
2. **Docker daemon** — smoke script existe; validação real ainda indisponível neste WSL.
3. **npm publish / site** `dont-waste.dev` — fora de escopo até release.
4. **CCR manual** — env CCR via wrap/proxy shell fora de MCP permanece manual (MCP marker-owned já cobre `ccrTtl` quando habilitado).

## Regras

- Não rodar `init --yes` nem installers reais contra HOME do usuário.
- Usar `HOME` + `DONT_WASTE_DATA_DIR` temporários.
- Preservar subcomandos; commits pequenos por fatia.
