# Handoff — Don’t Waste

Data do handoff: 2026-07-09

## Objetivo original

Implementar o v1 do **Don’t Waste**, um orquestrador local que integra Headroom, RTK, Caveman e Ponytail para Codex, Claude Code, Gemini CLI, Copilot CLI, Antigravity CLI, OpenCode e Pi. O plano técnico completo foi fornecido na conversa que originou este trabalho; não há PRD ou issue equivalente versionado no repositório.

## Estado do repositório

- Diretório: `/mnt/c/Users/Lucas/orca/projects/dont_waste`
- Branch: `master`, commit-base `cd9d25f` (`Initial commit`).
- **Nada foi commitado.** Todos os arquivos da implementação estão como untracked no `git status`.
- Node em uso: 22.23.1.
- O monorepo usa pnpm 10.16.1. `pnpm-lock.yaml` já existe.
- Não havia código antes deste trabalho; a árvore atual foi criada do zero.

## O que foi implementado

### Monorepo e distribuição

- Workspace pnpm e TypeScript estrito:
  - `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts`.
  - `apps/cli`, `apps/dashboard`.
  - `packages/catalog`, `core`, `adapters`, `telemetry`, `dashboard-api`, `test-fixtures`.
- A CLI é empacotada com tsup e expõe o binário `dont-waste`.
- As bibliotecas do workspace agora exportam `dist/index.js`/`dist/index.d.ts`; portanto o build deve ocorrer antes de executar a CLI compilada fora do tsx/Vitest.
- `vitest.config.ts` usa aliases para os arquivos `src` dos workspaces, evitando que testes dependam de builds pré-existentes.
- Foi adicionado `"type": "module"` ao pacote-raiz para evitar uma resolução CJS problemática do tsx.

### Catálogo e compatibilidade

Arquivo principal: `packages/catalog/src/index.ts`.

- IDs e matriz declarativa para as quatro ferramentas e os sete agentes.
- Tipos `ToolId`, `AgentId`, `Mode`, `Capability`, `MetricSupport` e `InstallMethod`.
- Metadados de upstream e seleção padrão `balanced`.
- Configurações globais de agentes detectadas de forma declarativa (ainda precisam de validação contra a documentação atual de cada CLI).

### Core local-first

Arquivos: `packages/core/src/*`.

- Paths por SO, com `DONT_WASTE_DATA_DIR` como override.
- `config.json` validado por Zod: perfil, política de atualização, integrações e projetos.
- `state.json` com operações e snapshots de arquivos.
- Criação de backup antes de operações, restauração/rollback e remoção de arquivos que não existiam antes.
- Diretórios planejados: config, state, SQLite, backups e logs.

### Telemetria SQLite e deduplicação

Arquivos: `packages/telemetry/src/*`.

- Banco via `node:sqlite`, com tabelas para installations, agents, agent_integrations, projects, sessions, metric_events, metric_imports e operations.
- Eventos distinguem `measured`, `estimated` e `unavailable`.
- Agregação só soma economia medida; estimativas ficam em total separado.
- Eventos com o mesmo `overlapKey` têm dupla contagem evitada pela menor `sourceDepth`.
- Importadores tolerantes para JSON de RTK e Headroom e parser de texto para estatísticas explícitas do Caveman.
- O importador Caveman **não** varre conversas ou logs automaticamente: só usa o arquivo que o usuário indicar em `DONT_WASTE_CAVEMAN_STATS_FILE`.

### Adaptadores

Arquivos: `packages/adapters/src/*`.

- Interface `ToolAdapter` com detect, capabilities, planInstall, install, verify, collectMetrics e uninstall.
- Detecção de executáveis, configurações e versões de agentes.
- Consulta de versão tem timeout de 3 segundos. Isto foi adicionado porque, neste ambiente, `gemini --version` ficou bloqueado.
- `headroom`:
  - Planeja `uv tool install "headroom-ai[all]"` (ou pip) e comandos `headroom wrap` apresentados como interativos.
  - `headroom doctor` e coleta `headroom perf --format json` são protegidos contra binário inexistente/inexecutável.
- `rtk`:
  - Planeja instalação via Homebrew ou instalador upstream e `rtk init` por agente.
  - Verifica/coleta com `rtk gain --all --format json`.
- `caveman`:
  - Planeja o instalador upstream Shell/PowerShell, verifica Node e registra estimativas separadas.
- `ponytail`:
  - Planeja comandos oficiais de marketplace/plugin/extensão; não aprova hooks do Codex automaticamente.
  - Mescla `@dietrichgebert/ponytail` em `opencode.json` e escreve `~/.config/ponytail/config.json` quando a instalação tem sucesso.

### CLI

Arquivo: `apps/cli/src/main.ts`.

Comandos presentes:

- `init`, `status`, `doctor`, `collect`, `dashboard`, `update`, `rollback <id>`, `uninstall`.
- Opções compartilhadas: `--dry-run`, `--json`, `--yes`.
- `init`:
  - Diagnostica agentes.
  - TUI com perfis balanced, maximum-savings, custom e install-only.
  - Em terminal interativo, pergunta por agente e faz uma tela/etapa por ferramenta (habilitar, modos Caveman/Ponytail, output shaper do Headroom e ultra-compact do RTK).
  - Mostra plano antes de alterar e exige confirmação, salvo `--yes`.
  - Cria snapshot, aplica adaptadores, roda health checks e registra resultado.
- `collect` grava imports no SQLite.
- `dashboard` coleta, inicializa Fastify em loopback por padrão e abre o browser; `--no-open` e `--port` existem para automação.
- `update` consulta os releases oficiais no GitHub e, com `--yes`, reaplica um plano idempotente.
- `rollback` restaura snapshot de operação; `uninstall` chama uninstallers e restaura snapshots de init/update.

### Dashboard

- API local Fastify em `packages/dashboard-api/src/index.ts`.
- Endpoints: `/api/overview`, `/api/events`, `/api/imports`, `/api/config`, `/api/tools`, `/api/health`.
- Função pura testável de resumo: `packages/dashboard-api/src/overview.ts`.
- SPA React/Vite em `apps/dashboard`, com páginas/tabs Overview, Timeline, Projects, Tools, Context, Configuration e Diagnostics.
- A SPA explicita dados medidos versus estimados e não apresenta conteúdo de prompts/saídas.
- Dashboard usa Recharts; o build atual gera um aviso de bundle >500 KB.

### Infraestrutura, documentação e testes

- Bootstrap scripts: `scripts/install.sh` e `scripts/install.ps1`.
- Docker: `docker/Dockerfile`, `docker/compose.yaml`.
- CI de matriz Ubuntu/macOS/Windows: `.github/workflows/ci.yml`.
- README: `README.md`.
- Fixtures sanitizadas: `packages/test-fixtures/src/index.ts`.
- Testes implementados:
  - catálogo/matriz;
  - paths de Linux/macOS/Windows;
  - snapshots/rollback;
  - importadores Headroom/RTK;
  - agregação medida/estimada e deduplicação;
  - função de overview do dashboard.

## Verificações efetivamente feitas

Os comandos abaixo foram executados durante o trabalho:

| Verificação | Resultado observado |
|---|---|
| `pnpm --filter @dont-waste/core typecheck` | passou |
| `pnpm --filter dont-waste typecheck` | passou após corrigir `rootDir` |
| `pnpm -r typecheck` | executado; nenhum erro foi observado, mas a ferramenta de terminal retornou saída parcial. Deve ser reexecutado pelo próximo agente. |
| Testes individuais Vitest | todos os testes listados acima passaram quando executados individualmente. |
| `vitest run --maxWorkers=1 --minWorkers=1` | iniciou e reportou testes passando, mas a captura do terminal foi interrompida/retornou saída parcial. Reexecutar para obter código de saída final. |
| `pnpm -r build` | dashboard foi compilado; a primeira tentativa falhou na CLI por `--banner`, depois foi corrigida usando `tsup.config.ts`. O build completo final deve ser reexecutado. |
| `node apps/cli/dist/main.js --help` | passou após tornar os pacotes internos externos ao bundle da CLI. |
| `node apps/cli/dist/main.js init --dry-run --json` | passou; detectou os CLIs deste ambiente, exibiu plano e não modificou arquivos. |
| `DONT_WASTE_DATA_DIR=$(mktemp -d) node apps/cli/dist/main.js collect --json` | passou; retornou imports sem falhar quando Headroom estava indisponível/inexecutável. |

Observação: o Node imprime `ExperimentalWarning` para `node:sqlite`; isto é esperado com a versão em uso.

## Onde o trabalho parou

O último passo em andamento era uma compilação sequencial de core, adapters, dashboard-api e CLI após os ajustes finais de TUI/paths/robustez dos adaptadores. A execução foi interrompida pela solicitação de handoff. Não há processo de build ou Vitest ativo conhecido no momento deste documento.

Antes do handoff, a CLI compilada funcionou em smoke tests, mas qualquer build final deve ser refeito para garantir que `dist/` reflita os últimos arquivos de `src/`.

## Lacunas importantes em relação ao plano original

Este é um scaffold funcional de v1, não o cumprimento completo de todos os critérios de aceite. O próximo agente deve tratar os itens abaixo como trabalho pendente, em ordem de prioridade.

### 1. Segurança e fidelidade dos adaptadores

- Pesquisar novamente as documentações/repositórios oficiais e confirmar cada comando, flag e localização de configuração. Algumas configurações de agentes foram inferidas do plano e podem estar defasadas.
- RTK ainda usa instaladores upstream por pipe (`curl | sh`/PowerShell). O plano pedia releases oficiais, arquitetura/SO, checksums e cancelamento em caso de falha de integridade; isso não foi implementado.
- Headroom não adiciona ainda o MCP de forma estruturada e idempotente a TOML/JSON dos agentes. Hoje apresenta o caminho/aviso e os wrappers interativos; é insuficiente para o critério de aceite de integração MCP.
- Headroom `wrap` abre uma sessão e por isso é corretamente marcado como interativo, mas o estado de integração deveria distinguir “comando de lançamento disponível” de “integração instalada/verificada”.
- RTK: verificar mapeamento de `rtk init` para OpenCode e demais agentes; alguns ainda usam o fallback `rtk init -g`.
- Caveman: não há aplicação persistente de todos os modos/recursos do plano, preview/backup de `/caveman-compress`, cavecrew ou caveman-shrink.
- Ponytail: `install()` escreve sempre `defaultMode: "full"`, ignorando o modo selecionado no plano. Corrigir para receber/persistir o modo escolhido. Uninstall só desfaz OpenCode; marketplaces/plugins de cada agente continuam pendentes.
- As verificações de plugin/hook são superficiais. O plano exige detectar plugin quebrado/configuração conflitante e só ativar quando a integração for realmente validada.

### 2. Operações e estado

- `init` pode executar instalações reais com `--yes`. Nunca rodar isso no ambiente do usuário sem plano revisado; usar somente `--dry-run` até endurecer os adaptadores.
- `uninstall` restaura snapshots de todas as operações init/update bem-sucedidas; revisar a semântica para evitar reverter alterações legítimas posteriores do usuário.
- Atualização só consulta tag de release e reaplica o plano; não compara versões instaladas/candidatas, não apresenta changelog por integração, não valida checksums nem implementa política `latest` em todo comando como especificado.
- `state.json` e SQLite registram bastante estado, mas relações projects/sessions/import cursors e adoção de instalações já existentes ainda são incompletas.

### 3. Métricas

- Confirmar formatos reais de `rtk gain --all --format json`, `headroom perf` e `headroom output-savings` com fixtures oficiais/sanitizadas. Os importadores são tolerantes, mas ainda não foram validados contra saídas reais atuais.
- `headroom perf --format json` pode não existir na versão upstream instalada; prever fallback/documentar.
- Falta importar output savings do Headroom e suportar holdout medido versus estimado com confiança/faixa.
- Não há importação segura de `/caveman-stats` das integrações de agentes; por privacidade, a implementação só aceita arquivo explicitamente informado. Projetar um importador oficial/opt-in.
- Falta modelar e visualizar corretamente sessões, projetos, custo/modelo, sobreposição complexa e `benchmark-reference`.

### 4. TUI e dashboard

- TUI ainda não reproduz todas as quatro etapas/tabelas detalhadas do plano. Faltam opções CCR/TTL, memória, `learn --verbosity` preview, categorias RTK, MCP shrink, cavecrew, preview de compressão e explicações completas de compatibilidade/reversão.
- O resumo do plano é textual; falta tabela por agente com arquivos modificados e reinícios necessários.
- Dashboard é funcional, mas páginas Tools/Configuration/Diagnostics mostram JSON bruto. Transformá-las em telas próprias, filtros, agregação diária/semanal, custo e mensagens de erro melhores.
- Não há Playwright. O plano pedia testes de UI (vazio, dados medidos, estimativas, filtros, erro e sobreposição visual).
- Avaliar code splitting do Recharts para remover o aviso de bundle >500 KB.

### 5. Docker, CI e publicação

- Executar `docker build -f docker/Dockerfile .` e `docker compose -f docker/compose.yaml ...`; ainda não foram testados. O Dockerfile atualmente copia `/app` inteiro do estágio de build para robustez de dependências de workspace; pode ser otimizado depois.
- CI não possui smoke de CLI por SO, teste Docker, nem Playwright; apenas typecheck/test/build de matriz.
- Não há configuração de publish npm, versionamento/release, site `dont-waste.dev` ou verificação de scripts bootstrap publicada.

## Riscos/decisões técnicas que o próximo agente deve conhecer

- `node:sqlite` foi escolhido conforme o plano; o warning experimental é esperado no Node 22 usado aqui.
- A CLI usa packages internos como dependências externas no tsup. Isso evita dois problemas encontrados:
  1. tsup reescreveu `node:sqlite` para o pacote inexistente `sqlite` quando telemetry era bundled;
  2. bundling de Fastify causou `Dynamic require of "events" is not supported` em ESM.
- Portanto, mantenha as bibliotecas internas construídas em `dist` antes de executar `apps/cli/dist/main.js`. O Dockerfile copia o workspace inteiro do estágio de build por esse motivo.
- O adapter de detecção comanda `--version` em paralelo. Não remova o timeout de 3 s: Gemini travou nessa consulta neste ambiente.
- `headroom` apareceu como caminho não executável neste ambiente. Os métodos de health/collect foram ajustados para devolver erro estruturado em vez de derrubar `collect`.
- Em alguns comandos longos, a captura de terminal do ambiente retornou antes do processo filho terminar. Use `ps`/código de saída ou execute comandos individualmente ao validar; não interprete saída parcial como sucesso.

## Sequência recomendada para o próximo agente

1. Ler este documento, `README.md` e o plano original da conversa. Inspecionar o `git diff --no-index /dev/null <arquivos>`/`git status` porque todo o trabalho está untracked.
2. Executar, nesta ordem, sem alterar configurações de agentes:

   ```sh
   corepack enable
   pnpm install --frozen-lockfile
   pnpm -r typecheck
   pnpm test
   pnpm -r build
   node apps/cli/dist/main.js init --dry-run --json
   DONT_WASTE_DATA_DIR="$(mktemp -d)" node apps/cli/dist/main.js collect --json
   ```

3. Corrigir qualquer falha de build/teste antes de expandir recursos. Confirmar que `apps/cli/dist/main.js --help` funciona após `pnpm -r build`.
4. Fazer pesquisa oficial dos quatro upstreams e dos sete agentes; atualizar a matriz e os comandos com fontes primárias.
5. Endurecer primeiro Headroom/RTK (idempotência, MCP/config merging, assinaturas/checksums e health checks), depois modos/uninstall de Caveman/Ponytail.
6. Completar importadores/métricas com fixtures reais e testes de integração, depois dashboards/Playwright/Docker/CI.
7. Só então revisar o diff, criar commits pequenos e fazer code review contra o plano original.

## Skills sugeridas para o próximo agente

- `implement`: continuar as fatias restantes do plano e obrigar verificação/commit ao final.
- `research`: confirmar comandos, formatos de métricas e compatibilidade diretamente na documentação oficial de Headroom, RTK, Caveman, Ponytail e agentes.
- `tdd`: usar nas costuras já definidas pelo plano (CLI, importadores, operações e API), após confirmar as costuras com o usuário se necessário.
- `code-review`: executar após haver commits e um ponto-base definido, comparando implementação com o plano original.
- `resolving-merge-conflicts`: somente se o próximo agente receber mudanças concorrentes.

## Arquivos mais relevantes

- CLI: `apps/cli/src/main.ts`, `apps/cli/tsup.config.ts`
- Dashboard: `apps/dashboard/src/main.tsx`, `packages/dashboard-api/src/index.ts`
- Adaptadores: `packages/adapters/src/`
- Telemetria: `packages/telemetry/src/`
- Estado/transações: `packages/core/src/operations.ts`
- Compatibilidade: `packages/catalog/src/index.ts`
- Testes: `packages/*/test/`
- Docker/CI: `docker/`, `.github/workflows/ci.yml`
