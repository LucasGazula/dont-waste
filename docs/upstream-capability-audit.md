# Auditoria de capacidades upstream × Don’t Waste

**Data:** 2026-07-10  
**Checkout auditado:** branch `antigravity` @ `0761c39` (`/mnt/c/Users/Lucas/orca/projects/dont_waste`)  
**Escopo:** comparar Don’t Waste (README, HANDOFF, `packages/catalog`, adapters, CLI, dashboard, testes) com os quatro upstreams oficiais — **Caveman**, **Ponytail**, **Headroom**, **RTK** — usando apenas fontes primárias (README/docs oficiais, código/CLI, releases GitHub).  
**Fora de escopo desta auditoria:** alterar README ou código; inventar flags; validar Docker daemon / publish / Playwright.

### Legenda de estado no Don’t Waste

| Estado                           | Significado                                                                        |
| -------------------------------- | ---------------------------------------------------------------------------------- |
| **coberto**                      | Orquestrado ou importado de forma verificável no adapter/CLI/telemetria            |
| **parcial**                      | Existe caminho, mas incompleto vs upstream (agentes, flags, métricas ou uninstall) |
| **intencionalmente unsupported** | Upstream existe; Don’t Waste recusa de propósito (privacidade, contrato, política) |
| **fora de escopo**               | Upstream/ecossistema paralelo; Don’t Waste não pretende orquestrar                 |
| **desconhecido**                 | Evidência primária insuficiente neste ambiente                                     |

---

## Fontes primárias consultadas

### Caveman

| Fonte          | URL                                                                     |
| -------------- | ----------------------------------------------------------------------- |
| README         | https://raw.githubusercontent.com/JuliusBrussee/caveman/main/README.md  |
| INSTALL.md     | https://raw.githubusercontent.com/JuliusBrussee/caveman/main/INSTALL.md |
| Release latest | https://github.com/JuliusBrussee/caveman/releases/tag/v1.9.1            |
| Repo           | https://github.com/JuliusBrussee/caveman                                |

### Ponytail

| Fonte          | URL                                                                      |
| -------------- | ------------------------------------------------------------------------ |
| README         | https://raw.githubusercontent.com/DietrichGebert/ponytail/main/README.md |
| Release latest | https://github.com/DietrichGebert/ponytail/releases/tag/v4.8.4           |
| Repo           | https://github.com/DietrichGebert/ponytail                               |

### Headroom

| Fonte          | URL                                                                       |
| -------------- | ------------------------------------------------------------------------- |
| README         | https://raw.githubusercontent.com/headroomlabs-ai/headroom/main/README.md |
| Docs CCR       | https://headroom-docs.vercel.app/docs/ccr (e fonte MDX no repo)           |
| Release latest | https://github.com/headroomlabs-ai/headroom/releases/tag/v0.31.0          |
| Repo           | https://github.com/headroomlabs-ai/headroom                               |

### RTK

| Fonte             | URL                                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| README (`master`) | https://raw.githubusercontent.com/rtk-ai/rtk/master/README.md                                                  |
| CLI local         | `rtk --help`, `rtk init --help`, `rtk gain --help`, `rtk config --help` (binário em PATH, release **v0.43.0**) |
| Release latest    | https://github.com/rtk-ai/rtk/releases/tag/v0.43.0                                                             |
| Repo              | https://github.com/rtk-ai/rtk (default branch `develop`)                                                       |

### Don’t Waste (referência interna)

| Área                | Caminhos                                                   |
| ------------------- | ---------------------------------------------------------- |
| Catálogo            | `packages/catalog/src/index.ts`                            |
| Contratos avançados | `packages/adapters/src/advanced-controls.ts`               |
| Adapters            | `packages/adapters/src/{caveman,ponytail,headroom,rtk}.ts` |
| CLI / TUI           | `apps/cli/src/{main,plan-summary,menu}.ts`                 |
| Docs                | `README.md`, `HANDOFF.md`                                  |

---

## 1. Caveman

### Tabela de capacidades

| Capacidade upstream                                                                      | Evidência                              | Estado no Don’t Waste                                 | Notas                                                                                                                                     |
| ---------------------------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Instalador unificado (`install.sh` / `install.ps1` / `npx github:…`)                     | README + INSTALL.md                    | **parcial**                                           | DW usa `npx -y github:JuliusBrussee/caveman` com `--only` / `--minimal` / `--non-interactive`; não cobre a matriz completa de 30+ agentes |
| `--only <agent>` para agentes DW (claude, gemini, opencode, codex, copilot, antigravity) | INSTALL.md tabela                      | **parcial**                                           | Mapeamento em `cavemanOnlyId`; **pi** sem `--only` (warning); Codex via skills no upstream, DW mapeia `codex`                             |
| Níveis `lite` / `full` / `ultra` / `wenyan`                                              | README                                 | **coberto**                                           | Persistidos em `.caveman-active` + `config.json` (`defaultMode`)                                                                          |
| Auto-ativação via markers/hooks                                                          | README / INSTALL                       | **parcial**                                           | Markers só para Claude Code e OpenCode; outros agentes dependem do installer upstream                                                     |
| `/caveman-stats` e statusline                                                            | README                                 | **parcial**                                           | Métricas só via ficheiro explícito `DONT_WASTE_CAVEMAN_STATS_FILE` (estimado); não lê logs de sessão automaticamente                      |
| `CAVEMAN_STATUSLINE_SAVINGS`                                                             | README                                 | **parcial**                                           | Feature TUI `statusline` documenta o env; não escreve o env automaticamente                                                               |
| Cavecrew subagents                                                                       | README                                 | **parcial**                                           | Feature `cavecrew` em config marker-owned; não instala pacotes cavecrew separados                                                         |
| `/caveman-compress` / compress memory                                                    | README                                 | **parcial**                                           | Feature `compress` em config; não executa o comando de compressão                                                                         |
| `caveman-shrink` MCP middleware                                                          | README + INSTALL (`--with-mcp-shrink`) | **intencionalmente unsupported** / **fora de escopo** | Opt-in upstream separado; DW não orquestra `--with-mcp-shrink`                                                                            |
| Comandos `/caveman-commit`, `/caveman-review`                                            | README                                 | **fora de escopo**                                    | Skills de fluxo de trabalho, não orquestração de instalação                                                                               |
| Ecossistema caveman-code / cavemem / cavekit                                             | README                                 | **fora de escopo**                                    | Repositórios irmãos                                                                                                                       |
| Uninstall sem apagar skills do utilizador                                                | INSTALL / SECURITY (privacidade local) | **coberto**                                           | Remove markers + limpa config owned; não corre uninstall destrutivo genérico                                                              |
| Privacidade (sem telemetria)                                                             | README Privacy                         | **coberto**                                           | Alinhado: DW não faz phone-home; stats só com ficheiro opt-in                                                                             |

### Instalação / config / métricas / uninstall / segurança

- **Install:** oficial via curl/ps1 ou `npx`; DW planeia `npx` com `--only` por agente selecionado.
- **Config:** upstream usa skill/hooks; DW escreve `.caveman-active` e `~/.config/caveman/config.json` com `dont-waste-owned`.
- **Métricas:** upstream `/caveman-stats` em logs locais; DW importa texto sanitizado como **estimated**, nunca measured.
- **Uninstall:** marker-owned only.
- **Segurança:** installer upstream verifica SHA-256 de hooks; DW não reimplementa o installer completo.

---

## 2. Ponytail

### Tabela de capacidades

| Capacidade upstream                                              | Evidência                         | Estado no Don’t Waste            | Notas                                                                                                                        |
| ---------------------------------------------------------------- | --------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Plugin Claude Code / Codex / Copilot CLI                         | README Install                    | **coberto**                      | Comandos oficiais de marketplace/install no adapter                                                                          |
| Gemini extension / Antigravity (`agy plugin install`)            | README                            | **coberto**                      | Inclui uninstall CLI                                                                                                         |
| Pi `pi install git:…`                                            | README                            | **coberto**                      |                                                                                                                              |
| OpenCode `plugin: ["@dietrichgebert/ponytail"]`                  | README                            | **coberto**                      | Merge JSON; uninstall remove entrada do plugin                                                                               |
| Níveis `lite` / `full` / `ultra` / `off`                         | README                            | **coberto**                      | `defaultMode` + marker `.ponytail-active`                                                                                    |
| `PONYTAIL_DEFAULT_MODE` / `config.json`                          | README                            | **parcial**                      | DW escreve `defaultMode` em config; não gere env `PONYTAIL_SUBAGENT_MATCHER`                                                 |
| Comandos `/ponytail-review`, `-audit`, `-debt`, `-gain`, `-help` | README                            | **fora de escopo**               | Skills de sessão; não orquestrados                                                                                           |
| Hosts instruction-only (Cursor, Windsurf, Cline, …)              | README                            | **fora de escopo**               | Fora da matriz de agentes DW                                                                                                 |
| Hermes / Devin / OpenClaw / Swival / Qoder / etc.                | README                            | **fora de escopo**               |                                                                                                                              |
| Telemetria operacional de tokens                                 | README (benchmarks de referência) | **intencionalmente unavailable** | Adapter devolve erro estruturado; sem fabricar savings                                                                       |
| Uninstall por host + `scripts/uninstall.js`                      | README Uninstall                  | **parcial**                      | CLI remove para Codex/Claude/Pi/Gemini/Copilot/Antigravity; cleanup de statusLine Claude via script upstream **não** chamado |
| Hooks Node no PATH                                               | README                            | **parcial**                      | Doctor/detect avisam Node; não instalam Node                                                                                 |

### Instalação / config / métricas / uninstall / segurança

- **Install:** comandos oficiais por agente; install-only não escreve configs.
- **Config:** marker-owned `dont-waste-owned` + `defaultMode`.
- **Métricas:** unavailable por desenho.
- **Uninstall:** preserva plugins alheios; OpenCode filtra só o pacote ponytail.
- **Segurança:** não lê conversas; não inventa telemetria.

---

## 3. Headroom

### Tabela de capacidades

| Capacidade upstream                                                   | Evidência                                    | Estado no Don’t Waste            | Notas                                                                                                                                     |
| --------------------------------------------------------------------- | -------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Install `uv tool install "headroom-ai[all]"` / pip                    | README                                       | **coberto**                      | Preferência uv, fallback pip                                                                                                              |
| `headroom wrap <agent>`                                               | README (claude, codex, copilot, opencode, …) | **parcial**                      | Wrap planeado como interactive/optional para codex/claude/copilot/opencode; **não** cobre cursor/aider/cline/goose/…                      |
| `headroom unwrap`                                                     | README                                       | **parcial**                      | Usado no uninstall quando binário presente                                                                                                |
| MCP `headroom mcp serve` + tools compress/retrieve/stats              | README                                       | **coberto**                      | Merge marker-owned Codex/Claude/OpenCode                                                                                                  |
| Proxy `headroom proxy`                                                | README                                       | **fora de escopo** / **parcial** | Não orquestra proxy standalone; wrap upstream pode subir proxy                                                                            |
| Library / SDK TS/Python                                               | README                                       | **fora de escopo**               |                                                                                                                                           |
| Cross-agent memory                                                    | README                                       | **fora de escopo**               |                                                                                                                                           |
| `HEADROOM_OUTPUT_SHAPER=1`                                            | README + advanced-controls                   | **coberto**                      | Escrito em env MCP marker-owned                                                                                                           |
| `HEADROOM_CCR_TTL_SECONDS`                                            | Docs CCR + advanced-controls                 | **coberto**                      | Valor `7200` em MCP marker-owned quando `ccrTtl`                                                                                          |
| CCR via wrap/proxy shell env (fora de MCP)                            | Docs CCR                                     | **parcial**                      | Pendência documentada: manual fora de MCP                                                                                                 |
| `headroom learn` / `learn --verbosity`                                | README                                       | **intencionalmente unsupported** | Privacidade: não minerar transcripts (`advanced-controls.ts`)                                                                             |
| “MCP-shrink” como flag discreta                                       | —                                            | **intencionalmente unsupported** | Sem flag/comando upstream verificado com esse nome                                                                                        |
| `headroom doctor` / `perf` / `stats` / `output-savings` / `dashboard` | README                                       | **parcial**                      | Doctor no verify; collect tenta perf → output-savings → stats JSON; dashboard Headroom próprio não orquestrado (DW tem dashboard próprio) |
| Frameworks LangChain/Agno/Strands/…                                   | README                                       | **fora de escopo**               |                                                                                                                                           |

### Instalação / config / métricas / uninstall / segurança

- **Install:** uv/pip + MCP merge; wrap não é lançado pelo installer.
- **Config:** apenas blocos MCP marker-owned; mismatch user-managed não é sobrescrito.
- **Métricas:** measured quando JSON upstream existe.
- **Uninstall:** unwrap opcional + unregister MCP marker-owned.
- **Segurança/privacidade:** local-first; DW não corre `learn`.

---

## 4. RTK

### Tabela de capacidades

| Capacidade upstream                                                                        | Evidência                                     | Estado no Don’t Waste            | Notas                                                                       |
| ------------------------------------------------------------------------------------------ | --------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------- |
| Install Homebrew / install.sh / release binaries / cargo                                   | README                                        | **parcial**                      | Darwin+brew ou download release com SHA-256; não usa `curl \| sh` nem cargo |
| `rtk init -g` / `--codex` / `--gemini` / `--copilot` / `--opencode` / `--agent antigravity | pi`                                           | README + `rtk init --help`       | **coberto**                                                                 | `rtkInitArgs` alinhado aos flags oficiais |
| Agentes Cursor / Windsurf / Cline / Hermes / etc.                                          | README / CLI                                  | **fora de escopo**               | Fora da matriz DW                                                           |
| Hooks só em shell/Bash (built-ins podem bypass)                                            | README (comportamento documentado no adapter) | **coberto** (aviso)              | Warning explícito no plan                                                   |
| `rtk gain` JSON / histórico                                                                | CLI `rtk gain --help`                         | **coberto**                      | Import measured via collect                                                 |
| `rtk --ultra-compact`                                                                      | CLI global flags                              | **parcial**                      | Feature TUI aconselha; **não** injeta flag nos hooks `init`                 |
| `rtk config`                                                                               | CLI                                           | **fora de escopo**               | Não orquestrado                                                             |
| `cc-economics` e dezenas de proxies de comando                                             | `rtk --help`                                  | **fora de escopo**               | Runtime do binário, não setup DW                                            |
| TTL temporal de cache                                                                      | CLI/README                                    | **intencionalmente unsupported** | RTK usa size/LRU; contrato `rtk-temporal-ttl`                               |
| `rtk init --uninstall`                                                                     | `rtk init --help`                             | **parcial**                      | DW não chama uninstall RTK genérico; rollback/snapshots DW                  |
| Verificação SHA-256 de release                                                             | Adapter `rtk-release.ts` + releases GitHub    | **coberto**                      |                                                                             |

### Instalação / config / métricas / uninstall / segurança

- **Install:** binário oficial verificado + `rtk init` por agente.
- **Config:** artefatos escritos pelo próprio `rtk init` (hooks/RTK.md).
- **Métricas:** `rtk gain --format json` → measured.
- **Uninstall:** sem uninstall genérico RTK no adapter; snapshots DW.
- **Segurança:** checksum obrigatório no path de release.

---

## Detalhe transversal Don’t Waste

| Tema                         | Estado                                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| Agentes suportados           | Codex, Claude Code, Gemini CLI, Copilot CLI, Antigravity CLI, OpenCode, Pi             |
| Telemetria                   | SQLite local; measured/estimated/unavailable; dedupe `overlapKey`; sem prompts/outputs |
| Dashboard                    | SPA + API locais; não substitui `headroom dashboard` upstream                          |
| Controles avançados Headroom | Só `outputShaper` + `ccrTtl` em MCP marker-owned                                       |
| Controles recusados          | `learn --verbosity`, MCP-shrink inventado, TTL temporal RTK                            |

---

## Conclusão objetiva

**Não:** Don’t Waste **não** possui todos os recursos dos quatro upstreams.

**Porquê (resumo factual):**

1. **É um orquestrador**, não um reimplementação: cobre instalação/ativação/métricas/uninstall **para a matriz de agentes declarada**, não a superfície completa de cada projeto (30+ agentes Caveman, dezenas de hosts Ponytail, proxy/library/memory Headroom, centenas de subcomandos RTK).
2. **Lacunas parciais conscientes:** wrap Headroom limitado; markers Caveman só em parte dos agentes; ultra-compact RTK só consultivo; uninstall Ponytail não corre `scripts/uninstall.js` upstream; CCR shell fora de MCP continua manual.
3. **Recusas intencionais:** `headroom learn --verbosity` (privacidade), “MCP-shrink” sem contrato verificável, TTL temporal RTK inexistente no upstream.
4. **Fora de escopo explícito:** ecossistemas irmãos (caveman-code, etc.), skills de sessão (`/ponytail-review`, `/caveman-commit`), frameworks Headroom, hosts IDE instruction-only.

Para o objetivo declarado do Don’t Waste — **orquestrar de forma local-first, segura e mensurável** as quatro ferramentas nos sete agentes do catálogo — a cobertura do núcleo (install planeado, ativação marker-owned onde aplicável, métricas honestas, uninstall não destrutivo) está **substancialmente alinhada**, mas **não é paridade de features** com os READMEs upstream.

---

_Relatório somente-leitura relativamente ao produto: nenhum README nem código de runtime foi alterado nesta tarefa._
