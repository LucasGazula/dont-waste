# Codex under Orca: dual-home MCP and plugin survival

Last verified: 2026-07-15 (user TUI acceptance: `/mcp` showed Headroom; Ponytail appeared as a skill).

## Problem

Don’t Waste and native `codex mcp add` / `codex plugin …` writes can look correct in the
managed Orca Codex home, then disappear on the next Orca launch. Caveman may still work
because skills are files under `$CODEX_HOME/skills/`, not `config.toml` sections.

## How Orca Codex homes work

Orca launches Codex with something like:

```text
CODEX_HOME=<orca-user-data>/codex-runtime-home/home
ORCA_CODEX_HOME=<same>
```

On WSL that is typically:

```text
/home/<user>/.local/share/orca/codex-runtime-home/home
```

On Windows AppData:

```text
%APPDATA%\orca\codex-runtime-home\home
```

Orca periodically merges the **system** Codex config into the managed home:

| Source (system) | Target (managed) |
| --- | --- |
| Linux: `~/.codex/config.toml` | WSL managed `…/codex-runtime-home/home/config.toml` |
| Windows: `%USERPROFILE%\.codex\config.toml` | AppData managed home |

Merge rule (from Orca’s managed-agent hook controls):

- Take system `config.toml` (minus runtime-owned hook-trust noise).
- Keep from the managed home only `[hooks.state.*]` and `[projects.*]`.
- **Do not** preserve managed-only `[mcp_servers.*]`, `[marketplaces.*]`, or `[plugins.*]`.

So MCP servers and plugin/marketplace entries must exist on the **system** home, or the next
sync wipes them from the managed home the TUI actually reads.

## Symptoms

| Observation | Meaning |
| --- | --- |
| `codex mcp list` empty in the live `CODEX_HOME` | Managed config lost MCP |
| `/mcp` shows app/plugin tools but not Headroom | Same; TUI loaded wiped config |
| Ponytail missing after a “successful” install | Marketplace/plugin sections wiped from managed `config.toml` |
| Caveman still visible | Skill symlink/files under `skills/` survived |
| `marketplace 'ponytail' is already added from a different source` | Orphan `$CODEX_HOME/.tmp/marketplaces/ponytail` without a registered marketplace |

## Repair (sessions closed)

Configure the **system** home first (merge source), then ensure the managed home matches.

```bash
# WSL / Linux Orca Codex
export CODEX_HOME="$HOME/.codex"
codex mcp add headroom -- headroom mcp serve
codex plugin marketplace remove ponytail   # only if orphan dir blocks add
codex plugin marketplace add DietrichGebert/ponytail
codex plugin add ponytail@ponytail

# Also set the managed home Orca actually launches (or let Orca sync from system)
export CODEX_HOME="${ORCA_CODEX_HOME:-$HOME/.local/share/orca/codex-runtime-home/home}"
codex mcp add headroom -- headroom mcp serve
# …same marketplace/plugin steps if still missing
```

Then **close every Codex TUI** and open a fresh Orca Codex session. A process that started on a
wiped config will not show new MCP/plugins until restart. Avoid relying on an exit of an old
session to “save” fixes; old in-memory config can overwrite the managed file again.

## Don’t Waste behavior

- `resolveCodexHomes()`: when `CODEX_HOME` contains `codex-runtime-home`, Headroom MCP
  registration also writes `~/.codex/config.toml` (system mirror).
- Orphan `# --- Headroom MCP server ---` markers without `[mcp_servers.headroom]` are repaired
  even when Orca hook sections follow the comment.
- Orphan Ponytail marketplace directories (on disk, not in `marketplace list`) plan
  `codex plugin marketplace remove ponytail` then re-add + plugin install.
- Runtime diagnostic warns if `auth.json` is missing or `CODEX_HOME` is Orca-managed.

## Acceptance checklist

1. Live process env: `CODEX_HOME` / `ORCA_CODEX_HOME` point at the managed home.
2. System `~/.codex/config.toml` contains `[mcp_servers.headroom]` and Ponytail marketplace/plugin.
3. Managed home `config.toml` contains the same after sync (or after explicit repair).
4. Fresh TUI: `/mcp` lists Headroom; Ponytail skill/plugin visible; Caveman still loads.
5. Prefer native Codex CLI mutations over hand-editing TOML when repairing live hosts.
