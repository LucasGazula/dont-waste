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
- Fixtures sanitizadas RTK/Headroom/Caveman; importadores com measured/estimated/holdout/benchmark-reference.
- Cursores de importação; upsert de projetos/sessões; atribuição project/agent/session/model/cost sem prompts/outputs.
- Dedupe por `overlapKey`; Caveman stats só via `DONT_WASTE_CAVEMAN_STATS_FILE`.

### Adaptadores (parcialmente endurecidos)

- **RTK:** download oficial + SHA-256 + timeout de fetch; extração com busca recursiva do binário; flags `rtk init` oficiais por agente; verify binary+gain.
- **Headroom:** install uv/pip; MCP merge idempotente (Codex/Claude/OpenCode); agentes sem MCP/wrap explicitados; collect com fallback perf → output-savings → stats.
- **Caveman:** `--only` por agente; markers `.caveman-active`; detect por markers (não por Node); install-only não escreve markers; uninstall remove só markers.
- **Ponytail:** persiste `defaultMode` + marker owned; detect por config/marker; install-only não escreve configs; uninstall preserva plugins/temas alheios.

### CLI

- Subcomandos: `menu`, `init`, `status`, `doctor`, `collect`, `dashboard`, `update`, `rollback`, `uninstall`.
- Sem argumentos em TTY → menu TUI (Setup, Status, Doctor, Collect, Dashboard, Update, Uninstall, Exit).
- `dashboard`: listen primeiro, imprime URL, collect em background.
- Ativação de integração só com `shouldActivateIntegration` (sem warn/fail; sem interactive obrigatório pulado; nunca em install-only).
- `doctor` e `/api/health` usam modos/features salvos (`configuredToolsFromConfig`); tools desabilitadas → skipped.
- `uninstall`: snapshot de todos os `uninstallPaths`, remove marker-owned, restaura snapshot se falhar, limpa integrations só no sucesso.
- `update`: compara versões instaladas vs GitHub, respeita `pinned`/`latest`, aplica só tools necessárias, preserva perfil/seleções/features.

### Dashboard

- API Fastify local + SPA React; overview/events/imports/projects/sessions/config/tools/health.
- Overview: daily/weekly aggregation, costs, overlap groups, privacy contract.
- `/api/events` filters: confidence, tool, project, session.
- SPA: Tools/Configuration/Diagnostics as structured tables (no raw JSON); Timeline/Context filters; projects/sessions/costs; empty/error/overlap/privacy states.
- Recharts loaded via `React.lazy` + dynamic `import()` (code-split).
- GET `/` sem conflito com fastifyStatic quando SPA existe.

### CLI TUI plan

- `formatPlanSummary`: tabela por agente com tools, paths, restart, compatibility, reversal e nota de controles avançados ainda não expostos.

## Verificações recentes

- `pnpm lint` / `typecheck` / `test` / `build` — reexecutar após esta fase.
- Docker Desktop/WSL: daemon pode estar offline; script de smoke faz skip explícito.

## Pendências restantes (próximas fases)

1. **npm publish / site** `dont-waste.dev` (fora desta fase).
2. **Validação Docker real** quando o daemon estiver acessível neste ambiente.
3. **Fidelidade residual** — Caveman cavecrew/compress; Ponytail uninstall CLI para todos os hosts.
4. **Playwright** — ainda sem infra no monorepo.

## Regras para o próximo agente

- Não rodar `init --yes` nem installers reais contra HOME do usuário.
- Usar `HOME` + `DONT_WASTE_DATA_DIR` temporários nos testes.
- Preservar subcomandos existentes.
- Commits pequenos por fatia.
