# Don’t Waste

Orquestrador **local-first** que integra as ferramentas upstream de redução de tokens [Headroom](https://github.com/headroomlabs-ai/headroom), [RTK](https://github.com/rtk-ai/rtk), [Caveman](https://github.com/JuliusBrussee/caveman) e [Ponytail](https://github.com/DietrichGebert/ponytail) nos agentes Codex, Claude Code, Gemini CLI, GitHub Copilot CLI, Antigravity CLI, OpenCode e Pi.

Don’t Waste **não** é uma reimplementação desses projetos e **não possui paridade total** com as suas superfícies (dezenas de hosts, proxies, skills de sessão, bibliotecas, etc.). A comparação verificada está em [`docs/upstream-capability-audit.md`](docs/upstream-capability-audit.md).

O que ele faz: planear, instalar/ativar (quando aplicável), validar, recolher métricas locais e desinstalar **integrações geridas** — sem ler credenciais e sem guardar prompts, saídas de ferramentas ou conversas.

---

## Pré-requisitos

| Requisito                       | Notas                                                                |
| ------------------------------- | -------------------------------------------------------------------- |
| **Node.js ≥ 22**                | `engines.node` do workspace                                          |
| **Corepack / pnpm**             | `packageManager`: `pnpm@10.16.1`                                     |
| Terminal interativo             | Menu TUI e confirmações de `init` / `uninstall` / `rollback`         |
| (Opcional) ferramentas upstream | Headroom, RTK, Caveman, Ponytail — só se quiser ativá-las de verdade |

**Distribuição npm global ainda é pendente.** Hoje o caminho suportado é o bootstrap a partir de um checkout local (abaixo). Um one-liner remoto (`curl | bash` / `irm | iex`) só será documentado quando existir URL Git pública ou pacote npm publicado.

### Bootstrap local (comando curto)

Pré-visualizar (não altera HOME/PATH/configs):

```bash
bash scripts/install.sh --dry-run
```

```powershell
pwsh scripts/install.ps1 -DryRun
```

Instalar o comando `dont-waste` (Node ≥ 22, Corepack/pnpm, `pnpm install` + `pnpm build`, shim reversível):

```bash
bash scripts/install.sh
# opcional: bash scripts/install.sh --prefix "$HOME/.local"
```

```powershell
pwsh scripts/install.ps1
# opcional: pwsh scripts/install.ps1 -Prefix "$env:LOCALAPPDATA\dont-waste"
```

Depois: garanta que `PREFIX/bin` está no `PATH`, corra `dont-waste --help`, e use `dont-waste` — a TUI **continua a pedir confirmação** antes de configurar adapters. Remover o shim: `bash scripts/install.sh --uninstall` / `pwsh scripts/install.ps1 -Uninstall`.

---

## Guias por sistema operativo (a partir do repositório)

Em todos os casos: clone o repo e entre na pasta. Preferência: o bootstrap acima. Alternativa manual: Corepack + pnpm. Os exemplos usam um diretório de dados temporário para não tocar no estado real do utilizador.

### Linux

```bash
# Pré-requisitos: Node.js 22+ no PATH
node -v

git clone <url-do-repositorio> dont_waste
cd dont_waste
bash scripts/install.sh --dry-run
bash scripts/install.sh

# Dados isolados (recomendado para exploração)
export DONT_WASTE_DATA_DIR="$(mktemp -d)"
export HOME="$(mktemp -d)"   # opcional: isola também deteção de configs de agentes

dont-waste --help
dont-waste status --dry-run
dont-waste doctor --dry-run
dont-waste init --dry-run
```

Alternativa sem shim: `corepack enable && pnpm install && pnpm build`, depois `pnpm --filter dont-waste dev -- …` ou `node apps/cli/dist/main.js …`.

Diretório de dados por omissão (sem `DONT_WASTE_DATA_DIR`):

`~/.local/share/dont-waste` (ou `$XDG_DATA_HOME/dont-waste`).

### macOS

```bash
# Pré-requisitos: Node.js 22+ (Homebrew ou instalador oficial)
node -v

git clone <url-do-repositorio> dont_waste
cd dont_waste
bash scripts/install.sh --dry-run
bash scripts/install.sh

export DONT_WASTE_DATA_DIR="$(mktemp -d)"
export HOME="$(mktemp -d)"

dont-waste --help
dont-waste status --dry-run
dont-waste doctor --dry-run
dont-waste init --dry-run
```

Diretório de dados por omissão: `~/Library/Application Support/dont-waste`.

### Windows (PowerShell)

```powershell
# Pré-requisitos: Node.js 22+ no PATH
node -v

git clone <url-do-repositorio> dont_waste
cd dont_waste
pwsh scripts/install.ps1 -DryRun
pwsh scripts/install.ps1

$env:DONT_WASTE_DATA_DIR = Join-Path $env:TEMP ("dont-waste-data-" + [guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $env:DONT_WASTE_DATA_DIR | Out-Null

dont-waste --help
dont-waste status --dry-run
dont-waste doctor --dry-run
dont-waste init --dry-run
```

Diretório de dados por omissão: `%APPDATA%\dont-waste`.

### Uso do repositório vs npm global

| Caminho                                                | Quando usar                      |
| ------------------------------------------------------ | -------------------------------- |
| `bash scripts/install.sh` / `pwsh scripts/install.ps1` | Bootstrap local suportado hoje   |
| `pnpm --filter dont-waste dev -- …`                    | Desenvolvimento sem shim         |
| `node apps/cli/dist/main.js …` após `pnpm build`       | Binário local do workspace       |
| `npm install -g dont-waste`                            | **Ainda não** — publish pendente |

---

## Quick start seguro

Comece **sempre** por comandos de leitura / dry-run. Não use `init --yes` nem installers reais contra o seu `HOME` até ter revisto o plano.

```bash
# Linux / macOS — bootstrap preview + dados temporários
bash scripts/install.sh --dry-run
export DONT_WASTE_DATA_DIR="$(mktemp -d)"

dont-waste --help          # após bootstrap; ou: pnpm --filter dont-waste dev -- --help
dont-waste status
dont-waste doctor
dont-waste init --dry-run
dont-waste collect --dry-run
dont-waste update --dry-run
dont-waste uninstall --dry-run
```

PowerShell (equivalente):

```powershell
$env:DONT_WASTE_DATA_DIR = Join-Path $env:TEMP ("dont-waste-data-" + [guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $env:DONT_WASTE_DATA_DIR | Out-Null

pnpm --filter dont-waste dev -- --help
pnpm --filter dont-waste dev -- status
pnpm --filter dont-waste dev -- doctor
pnpm --filter dont-waste dev -- init --dry-run
```

A CLI mostra os comandos upstream e os caminhos de configuração **antes** de aplicar alterações. Use `--yes` só em automação não assistida, depois de confiar no plano.

---

## Referência de comandos (confirmados em `--help`)

Uso geral:

```text
dont-waste [options] [command]
  -V, --version
  -h, --help
```

Sem argumentos num terminal interativo (stdin/stdout TTY), abre o **menu TUI**. Em ambiente não interativo, use subcomandos ou `dont-waste menu` (este exige TTY).

| Comando          | Função                                                                                  | Opções relevantes                                        |
| ---------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `menu`           | Menu interativo                                                                         | (nenhuma além de `-h`)                                   |
| `init`           | Detetar, planear, instalar e validar integrações                                        | `--profile`, `--channel`, `--dry-run`, `--json`, `--yes` |
| `status`         | Ferramentas, agentes, perfil e saúde                                                    | `--dry-run`, `--json`, `--yes`                           |
| `doctor`         | Revalidar binários, PATH, base de dados e integrações                                   | `--dry-run`, `--json`, `--yes`                           |
| `collect`        | Importar métricas locais das ferramentas ativas                                         | `--dry-run`, `--json`, `--yes`                           |
| `dashboard`      | Arrancar dashboard local (collect em background após listen)                            | `--port`, `--no-open`, `--dry-run`, `--json`, `--yes`    |
| `update`         | Comparar releases oficiais e aplicar upgrade idempotente                                | `--dry-run`, `--json`, `--yes`                           |
| `rollback <id>`  | Restaurar snapshot de configuração de uma operação                                      | `--dry-run`, `--json`, `--yes`                           |
| `uninstall`      | Remover integrações geridas pelo Don’t Waste (não apaga ferramentas upstream adoptadas) | `--dry-run`, `--json`, `--yes`                           |
| `help [command]` | Ajuda                                                                                   |                                                          |

### `init` — perfis e canais

- `--profile`: `balanced` \| `maximum-savings` \| `custom` \| `install-only`
- `--channel`: `pinned` \| `latest`

| Perfil            | Comportamento (resumo)                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `balanced`        | Modos `full` nas quatro ferramentas; features avançadas Headroom/RTK desligadas por omissão |
| `maximum-savings` | Caveman `ultra`; Headroom `outputShaper` + `ccrTtl`; RTK `ultraCompact` (consultivo)        |
| `custom`          | Escolha interativa de ferramentas, modos e features                                         |
| `install-only`    | Instala ferramentas sem ativar integrações nos agentes                                      |

### Opções comuns

- `--dry-run` — mostra o plano / resultado sem modificar a máquina
- `--json` — saída machine-readable
- `--yes` — salta a confirmação depois do plano (automação)

### Exemplos nos três SO

**Linux / macOS**

```bash
pnpm --filter dont-waste dev -- init --profile balanced --channel pinned --dry-run
pnpm --filter dont-waste dev -- status --json
pnpm --filter dont-waste dev -- doctor
pnpm --filter dont-waste dev -- collect --dry-run
pnpm --filter dont-waste dev -- dashboard --port 3000 --no-open --dry-run
pnpm --filter dont-waste dev -- update --dry-run
pnpm --filter dont-waste dev -- rollback <operation-id> --dry-run
pnpm --filter dont-waste dev -- uninstall --dry-run
```

**Windows PowerShell**

```powershell
pnpm --filter dont-waste dev -- init --profile balanced --channel pinned --dry-run
pnpm --filter dont-waste dev -- status --json
pnpm --filter dont-waste dev -- doctor
pnpm --filter dont-waste dev -- collect --dry-run
pnpm --filter dont-waste dev -- dashboard --port 3000 --no-open --dry-run
pnpm --filter dont-waste dev -- update --dry-run
pnpm --filter dont-waste dev -- rollback <operation-id> --dry-run
pnpm --filter dont-waste dev -- uninstall --dry-run
```

---

## Menu TUI

Com TTY e sem argumentos, ou com `dont-waste menu`:

| Entrada         | Ação        |
| --------------- | ----------- |
| Setup           | `init`      |
| Status          | `status`    |
| Doctor          | `doctor`    |
| Collect metrics | `collect`   |
| Open dashboard  | `dashboard` |
| Check updates   | `update`    |
| Uninstall       | `uninstall` |
| Exit            | sair        |

`rollback` não está no menu; use o subcomando com o `operation-id` impresso após `init` / `update`.

---

## Dashboard e telemetria

### Dashboard

`dont-waste dashboard` sobe o servidor local, imprime um URL utilizável e mantém o processo até Ctrl+C. A recolha de métricas corre em background **depois** do listen.

- Construa `apps/dashboard` (via `pnpm build`) **ou** defina `DONT_WASTE_DASHBOARD_ASSETS` para servir a SPA; caso contrário aparece a página só-API.
- `DONT_WASTE_DASHBOARD_HOST` — host de bind (ex.: `0.0.0.0` no Docker).
- `--port` — porta local; `--no-open` — não abrir o browser.

### Política de medição

| Fonte                         | Tipo            | Notas                                                                                    |
| ----------------------------- | --------------- | ---------------------------------------------------------------------------------------- |
| RTK (`rtk gain`)              | **measured**    | Só com valores observados before/after                                                   |
| Headroom (`perf` / fallbacks) | **measured**    | Idem                                                                                     |
| Caveman                       | **estimated**   | Só com ficheiro explícito `DONT_WASTE_CAVEMAN_STATS_FILE`; nunca entra no total measured |
| Ponytail                      | **unavailable** | Sem telemetria operacional de tokens; não se fabricam savings                            |

Se RTK e Headroom transformaram o mesmo fluxo, o total measured mantém só a observação mais antiga (`overlapKey`). Dados em SQLite local (`dont-waste.sqlite` no diretório de dados).

### Privacidade e dados locais

- Sem phone-home; sem prompts/outputs/conversas.
- Diretório de dados: ver secção por SO; override com `DONT_WASTE_DATA_DIR`.
- Conteúdo típico: `config.json`, `state.json`, `dont-waste.sqlite`, `backups/`, `logs/`.
- Operações criam snapshots; `rollback <id>` restaura a configuração dessa operação.
- `uninstall` remove integrações **geridas** (markers / merges marker-owned); não apaga ferramentas upstream que o utilizador já tinha.

---

## Ferramentas, agentes, modos e controlos avançados

### Agentes suportados

| ID                | Label              | Executável |
| ----------------- | ------------------ | ---------- |
| `codex`           | Codex              | `codex`    |
| `claude-code`     | Claude Code        | `claude`   |
| `gemini-cli`      | Gemini CLI         | `gemini`   |
| `copilot-cli`     | GitHub Copilot CLI | `copilot`  |
| `antigravity-cli` | Antigravity CLI    | `agy`      |
| `opencode`        | OpenCode           | `opencode` |
| `pi`              | Pi                 | `pi`       |

### Ferramentas e métricas (catálogo)

| Tool     | Métodos típicos                                                  | Métricas    |
| -------- | ---------------------------------------------------------------- | ----------- |
| Headroom | proxy (wrap) em Codex/Claude/Copilot/OpenCode; MCP nos restantes | measured    |
| RTK      | hooks (`rtk init` por agente)                                    | measured    |
| Caveman  | plugin / extension                                               | estimated   |
| Ponytail | plugin / extension                                               | unavailable |

Modos Caveman/Ponytail no setup: `lite` / `full` / `ultra` / `wenyan` (Caveman) e `lite` / `full` / `ultra` / `off` (Ponytail), conforme o fluxo interativo.

### Features no setup (TUI / perfis)

| Feature                                | Tool     | Efeito no Don’t Waste                                                            |
| -------------------------------------- | -------- | -------------------------------------------------------------------------------- |
| `outputShaper`                         | Headroom | Escreve `HEADROOM_OUTPUT_SHAPER=1` em entradas MCP marker-owned                  |
| `ccrTtl`                               | Headroom | Escreve `HEADROOM_CCR_TTL_SECONDS=7200` em MCP marker-owned                      |
| `ultraCompact`                         | RTK      | Aconselha `rtk --ultra-compact`; **não** injeta a flag nos hooks `init`          |
| `statusline` / `cavecrew` / `compress` | Caveman  | Marcadores / config marker-owned; não substituem o ecossistema completo upstream |

### Intencionalmente unsupported / pendências

Documentado em código (`packages/adapters/src/advanced-controls.ts`) e na [auditoria](docs/upstream-capability-audit.md):

- `headroom learn --verbosity` — privacidade (não minerar transcripts)
- “MCP-shrink” como flag discreta — sem contrato upstream verificado
- TTL temporal RTK — RTK usa size/LRU, não TTL de tempo
- CCR via wrap/proxy **fora** de MCP — permanece manual
- Publish npm / site — pendente
- Playwright E2E — sem infra no monorepo

---

## Tabela de funções (visão rápida)

| Função                      | Como                                                       |
| --------------------------- | ---------------------------------------------------------- |
| Ver ajuda                   | `dont-waste --help` / `dont-waste <cmd> --help`            |
| Menu                        | sem args (TTY) ou `dont-waste menu`                        |
| Planear sem alterar         | `init --dry-run`                                           |
| Estado / saúde              | `status`, `doctor`                                         |
| Métricas                    | `collect`                                                  |
| UI local                    | `dashboard`                                                |
| Atualizar upstreams geridos | `update`                                                   |
| Desfazer operação           | `rollback <id>`                                            |
| Remover integrações DW      | `uninstall`                                                |
| Isolar dados                | `DONT_WASTE_DATA_DIR` (+ `HOME` temporário se necessário)  |
| SPA do dashboard            | build de `apps/dashboard` ou `DONT_WASTE_DASHBOARD_ASSETS` |
| Stats Caveman (estimado)    | `DONT_WASTE_CAVEMAN_STATS_FILE`                            |

---

## Docker (só visualização)

O contentor **só** visualiza dados já recolhidos; **não** instala nem configura agentes no host.

```bash
export DONT_WASTE_HOST_DATA_DIR="$HOME/.local/share/dont-waste"   # Linux
# macOS: ~/Library/Application Support/dont-waste
# Windows: %APPDATA%\dont-waste
docker compose -f docker/compose.yaml run --service-ports --rm dashboard
```

```bash
docker build -f docker/Dockerfile -t dont-waste .
```

---

## Desenvolvimento e CI

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

CI (Ubuntu / macOS / Windows): Prettier → typecheck → test → build → smoke CLI não destrutivo (`--help`, `init`/`update`/`collect --dry-run`, dashboard dry-run).

Pacote publicável: `dont-waste` (`apps/cli`) — `bin` → `./dist/main.js`, `files` → `["dist"]`.

---

## Troubleshooting

| Sintoma                    | O que verificar                                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Menu falha sem TTY         | Use subcomandos ou abra um terminal real                                                                         |
| Dashboard sem SPA          | `pnpm build` em `apps/dashboard` ou `DONT_WASTE_DASHBOARD_ASSETS`                                                |
| Doctor falha em tool       | Tool não está no PATH / não está enabled na config                                                               |
| Collect vazio              | Ferramenta sem métricas ainda; Ponytail é sempre unavailable; Caveman precisa de `DONT_WASTE_CAVEMAN_STATS_FILE` |
| Alterações no HOME errado  | Defina `DONT_WASTE_DATA_DIR` (e `HOME` temporário) **antes** de `init`                                           |
| Esperava paridade upstream | Leia [`docs/upstream-capability-audit.md`](docs/upstream-capability-audit.md)                                    |

---

## Documentação relacionada

- [`docs/upstream-capability-audit.md`](docs/upstream-capability-audit.md) — auditoria Don’t Waste × Caveman / Ponytail / Headroom / RTK
- [`HANDOFF.md`](HANDOFF.md) — estado do branch e pendências de release
