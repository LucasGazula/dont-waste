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
- CI matriz Ubuntu/macOS/Windows; Dockerfiles/compose presentes (smoke Docker ainda não validado neste ambiente).

### Catálogo, core, telemetria
- Matriz declarativa de tools/agentes/modos.
- `config.json`/`state.json`, snapshots/rollback, `DONT_WASTE_DATA_DIR`.
- SQLite local (`node:sqlite`) com events/imports/operations; dedupe por `overlapKey`; Caveman stats só via `DONT_WASTE_CAVEMAN_STATS_FILE`.

### Adaptadores (parcialmente endurecidos)
- **RTK:** download de release oficial GitHub + SHA-256; `rtk init` por agente; sem uninstall genérico estável.
- **Headroom:** install uv/pip; MCP merge idempotente (Codex markers / Claude / OpenCode) sem sobrescrever mismatch; wrap marcado `interactive` + `optional`.
- **Caveman:** `--only` por agente; markers `.caveman-active`; detect por markers (não por Node); install-only não escreve markers; uninstall remove só markers.
- **Ponytail:** persiste `defaultMode` + marker owned; detect por config/marker; install-only não escreve configs; uninstall preserva plugins/temas alheios e só remove owned.

### CLI
- Subcomandos: `menu`, `init`, `status`, `doctor`, `collect`, `dashboard`, `update`, `rollback`, `uninstall`.
- Sem argumentos em TTY → menu TUI (Setup, Status, Doctor, Collect, Dashboard, Update, Uninstall, Exit).
- `dashboard`: listen primeiro, imprime URL, collect em background.
- Ativação de integração só com `shouldActivateIntegration` (sem warn/fail; sem interactive obrigatório pulado; nunca em install-only).
- `doctor` e `/api/health` usam modos/features salvos (`configuredToolsFromConfig`); tools desabilitadas → skipped.
- `uninstall`: snapshot de todos os `uninstallPaths`, remove marker-owned, restaura snapshot se falhar, limpa integrations só no sucesso.

### Dashboard
- API Fastify local + SPA React; overview/events/imports/config/tools/health.
- GET `/` sem conflito com fastifyStatic quando SPA existe.

## Verificações recentes
- `pnpm typecheck` / `pnpm test` / `pnpm build` — reexecutar após esta fase.
- Smoke dashboard com `DONT_WASTE_DATA_DIR` temp já passou em commit anterior (`/api/health` 200).

## Pendências restantes (próximas fases)

1. **Adaptadores / fidelidade upstream** — confirmar docs oficiais; Headroom wrap vs MCP na UX de status; RTK verify mais forte; Caveman cavecrew/compress; Ponytail uninstall CLI para todos os hosts.
2. **Update** — comparar versões instaladas vs GitHub; changelog; política `latest`.
3. **Métricas** — fixtures reais RTK/Headroom; fallback `headroom perf`; output-savings; projetos/sessões/cursors.
4. **Dashboard/TUI** — páginas Tools/Config/Diagnostics sem JSON cru; filtros; code-split Recharts; TUI avançada (CCR/TTL/etc.).
5. **Docker/CI/publish** — smoke Docker; smoke CLI na CI; npm publish / site.

## Regras para o próximo agente
- Não rodar `init --yes` nem installers reais contra HOME do usuário.
- Usar `HOME` + `DONT_WASTE_DATA_DIR` temporários nos testes.
- Preservar subcomandos existentes.
- Commits pequenos por fatia.
