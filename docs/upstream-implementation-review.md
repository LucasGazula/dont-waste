# Upstream implementation review

Date: 2026-07-11

## Conclusion

Don’t Waste is not failing for one reason. The local adapters currently mix
three different concepts:

1. installing an upstream binary, plugin, skill, or extension;
2. enabling an always-on integration for a specific host; and
3. presenting a Don’t Waste setup UI.

The four upstreams do not share one activation model. In particular, Codex
uses instruction/skill/plugin mechanisms rather than the same slash-command
surface as Claude Code or Gemini. The local implementation currently reports
some marker/config files as installed even when the host-specific plugin or
skill was not installed.

## Findings by upstream

### RTK

RTK’s official Codex integration is `rtk init -g --codex`, and its documented
mechanism is `AGENTS.md + RTK.md` instructions, not a transparent shell hook.
The official supported-agents guide explicitly classifies Codex as
prompt-level instructions, while Claude, Gemini, OpenCode, and Pi use hook or
plugin mechanisms.

Sources: [RTK README](https://github.com/rtk-ai/rtk/blob/master/README.md),
[RTK supported agents](https://github.com/rtk-ai/rtk/blob/master/docs/guide/getting-started/supported-agents.md).

The local RTK command mapping is broadly aligned with upstream. The important
local risk found during this review was path resolution: RTK honors `CODEX_HOME` for Codex global paths
([RTK changelog](https://github.com/rtk-ai/rtk/blob/master/CHANGELOG.md#L512-L514)),
but the pre-fix Don’t Waste code constructed Codex paths as `$HOME/.codex` in
`packages/catalog/src/index.ts` and `packages/adapters/src/mcp.ts`. In a managed
Codex runtime, these can be different directories. The active Codex session
in this workspace has `CODEX_HOME=/home/lucas/.local/share/orca/codex-runtime-home/home`,
while the pre-fix plan displayed `/home/lucas/.codex/...`. The adapter now
resolves Codex paths through `CODEX_HOME` and retains `$HOME/.codex` as the
fallback.

### Ponytail

The official Codex installation is two non-interactive commands:

```text
codex plugin marketplace add DietrichGebert/ponytail
codex plugin add ponytail@ponytail
```

The user must then open `/hooks`, review/trust the two lifecycle hooks, and
start a new thread. The plugin manifest declares the Claude/Codex lifecycle
hooks. Ponytail’s command documentation also says that in Codex the bundled
commands are skills invoked with `@` (for example `@ponytail-review`), not
necessarily entries in the `/` menu.

Sources: [Ponytail README](https://github.com/DietrichGebert/ponytail/blob/main/README.md#L126-L135),
[Ponytail commands](https://github.com/DietrichGebert/ponytail/blob/main/README.md#L285-L296),
[Ponytail plugin manifest](https://raw.githubusercontent.com/DietrichGebert/ponytail/main/.claude-plugin/plugin.json),
[Ponytail lifecycle hooks](https://raw.githubusercontent.com/DietrichGebert/ponytail/main/hooks/claude-codex-hooks.json).

Before this review, the local adapter planned `codex` as an interactive
launch-only step after marketplace registration. That meant it did not perform
the official `codex plugin add ponytail@ponytail` operation itself. The adapter
now performs that command and leaves only the required `/hooks` trust/restart
step manual. Its marker/config files are still Don’t Waste state, not proof of
hook approval.

Gemini, OpenCode, Antigravity, and Pi have different official install paths;
the local adapter should keep those paths separate instead of treating the
Codex interactive flow as a fallback for all hosts.

### Caveman

Caveman’s official Codex path is `npx skills add JuliusBrussee/caveman -a codex`,
and its documented activation is per-session `/caveman`. Its installer also
has an explicit provider matrix and supports `--only <agent>`.

Sources: [Caveman README](https://github.com/JuliusBrussee/caveman/blob/main/README.md),
[Caveman installation matrix](https://github.com/JuliusBrussee/caveman/blob/main/INSTALL.md),
[Caveman installer source](https://github.com/JuliusBrussee/caveman/blob/main/bin/install.js#L580-L591).

The pre-fix `CavemanAdapter` had a correctness bug in its idempotency check:
`planInstall` computes one `alreadyActive` value from all selected agents and
then suppresses the single upstream install command for all of them. It also
only creates Don’t Waste mode markers for Claude Code and OpenCode. Therefore,
an existing Claude/OpenCode marker or shared config can cause a selected Codex
installation to be skipped, which explained why `/caveman` could not appear
in a new Codex session.

The adapter now detects/installs per agent and verifies the Codex skill under
`CODEX_HOME/skills/caveman/SKILL.md`; a successful global Caveman config is not
treated as proof that the Codex skill exists.

### Headroom

Headroom officially supports both `headroom wrap codex` and an MCP server.
Its Codex guidance recommends installing the CLI as a persistent tool and
using an absolute binary path in the MCP configuration when the client may not
inherit the shell `PATH`.

Source: [Headroom README](https://github.com/headroomlabs-ai/headroom/blob/main/README.md#L23-L26).

The local adapter’s absolute-path MCP registration is directionally correct.
However, it marks `headroom wrap <agent>` as interactive and skips it during
installation. That is a deliberate safety choice, not a complete Headroom
wrap installation. The product must state clearly whether Headroom is being
enabled through MCP or whether the user must launch a wrapped session.

## Don’t Waste setup versus agent commands

Don’t Waste’s setup is a terminal CLI operation (`dont-waste init` or the
interactive menu). The remote installer deliberately launches that setup after
bootstrapping in `scripts/install-remote.sh`. Running the remote installer
again will therefore show setup again by design.

The upstream slash/skill commands are host-specific. `/init` and `/setup`
typed inside Codex are not Don’t Waste’s terminal setup command. Ponytail’s
Codex commands are skills (`@...`) after plugin installation; Caveman’s
session command is `/caveman`; RTK’s Codex integration is an instruction file.
Don’t Waste does not currently install a `/setup` command into Codex.

## Priority correction plan

1. **Completed:** resolve Codex-specific paths through `CODEX_HOME` for agent
   config discovery, MCP registration, and affected-path snapshots.
2. **Completed:** detect/install Caveman independently per selected agent,
   including Codex skill installation and verification.
3. **Completed:** run Ponytail’s official Codex `plugin add` command, retain
   idempotent marketplace registration, and report the manual `/hooks` step.
4. **Completed:** make the Codex Caveman verification host-specific.
5. **Completed:** add regression tests for the upstream commands and paths;
   the remote installer now launches one direct `dont-waste init` flow.
