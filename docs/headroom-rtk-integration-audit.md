# Headroom and RTK integration audit

Audit date: 2026-07-13  
Checkout: `386a75d` (`main`, synced with `origin/main`)

## Scope and method

This audit compares the adapters with the current upstream repositories and
then checks the installed tools on the host. It distinguishes configuration
from actual runtime traffic: an MCP registration or an RTK rule file is not by
itself evidence that a host used the integration.

Primary sources inspected:

- [Headroom MCP guide](https://headroomlabs-ai.github.io/headroom/mcp/)
- [Headroom CLI reference](https://headroomlabs-ai.github.io/headroom/cli/)
- [`headroomlabs-ai/headroom` source](https://github.com/headroomlabs-ai/headroom)
- [RTK supported agents](https://github.com/rtk-ai/rtk/blob/master/docs/guide/getting-started/supported-agents.md)
- [RTK README](https://github.com/rtk-ai/rtk)

## Headroom

### Confirmed

- `headroom-ai[all]` includes the MCP/proxy surface used by Don’t Waste.
- The adapter's stdio command, `headroom mcp serve`, is a documented public
  command. Registering it manually for Codex and other MCP-capable hosts is
  appropriate; upstream's one-command installer is Claude-specific.
- Host evidence from Headroom `0.31.0` says its MCP SDK is installed and the
  Claude Code, Codex, and OpenCode MCP entries are configured.
- Headroom MCP-only mode can compress only when an agent calls its MCP tools;
  it does not require the proxy, but it also does not automatically transform
  every model request.

### Runtime state on this host

`headroom doctor` and `headroom mcp status` both report that the local proxy at
`127.0.0.1:8787` is not running. `headroom perf --format json` reports zero
proxy requests and zero Headroom token savings. Therefore the configured MCP
servers may be available to hosts, but there is no evidence of proxy-based
automatic compression or savings on this host.

### Implementation gaps

1. `packages/adapters/src/headroom.ts` plans `headroom wrap opencode`, but the
   current official wrap surface lists Claude, Copilot, Codex, Aider, Cursor,
   and OpenClaw—not OpenCode. The OpenCode wrap command should not be planned.
2. The saved Don’t Waste config marks Headroom disabled even though Headroom
   itself confirms three configured MCP entries. Consequently `dont-waste
doctor` skips Headroom and cannot report the real partial state.
3. `HEADROOM_OUTPUT_SHAPER=1` is currently injected into the MCP server's
   environment. Upstream implements output shaping in the **proxy** and
   documents enabling it before `headroom proxy` or `headroom wrap`; MCP-only
   registration cannot activate that proxy behavior. The control must either
   configure the launched/persistent proxy or be unavailable for MCP-only
   installs.
4. `headroom output-savings` currently has no `--format json` option and there
   is no `headroom stats` command. The adapter's fallback metric commands are
   therefore invalid if `headroom perf --format json` does not produce usable
   data.

## RTK

### Confirmed

- Every adapter initialization command matches the current upstream mapping:
  Codex (`init -g --codex`), Claude Code (`init -g`), Copilot (`-g
--copilot`), Antigravity (`--agent antigravity`), OpenCode (`-g --opencode`),
  and Pi (`-g --agent pi`).
- The installed RTK is `0.42.4`. `rtk init --show` confirms the Claude hook,
  Claude `RTK.md` reference, Claude settings entry, and OpenCode plugin.
- `rtk gain --all --format json` works and reports 1,479 commands and 439,433
  saved tokens (31.21%) in its local history at audit time. This is real RTK
  telemetry data, though it is aggregated rather than attributed to a specific
  host session.
- Using `RTK_TELEMETRY_DISABLED=1` for automated `rtk init` is a supported
  privacy override.

### Limits that must remain visible

- Claude Code, Copilot, OpenCode, and Pi can rewrite commands through a hook
  or plugin. Codex and Antigravity use instructions/rules only: they tell the
  model to prefer `rtk <command>` and cannot prove or guarantee interception.
- Upstream defines Antigravity's RTK rule as project-scoped. Running Don’t
  Waste from this repository creates `.agents/rules/antigravity-rtk-rules.md`
  here; it does not enable RTK in unrelated Antigravity projects.
- `--ultra-compact` is a per-invocation RTK flag (`rtk --ultra-compact <cmd>`),
  not a persistent hook option. Don’t Waste currently records the preference
  and explains it, but cannot make arbitrary hook-rewritten commands use it.
- `RtkAdapter.verify()` only checks the RTK binary and whether `rtk gain` can
  run. A passing Don’t Waste doctor result does not verify Codex, Antigravity,
  Pi, or any other per-agent artifact.

## Recommended next implementation slice

1. Reconcile the Headroom MCP configuration with Don’t Waste's persisted
   integration state, so `doctor` reports its real health.
2. Remove unsupported OpenCode wrapping and make Headroom's output-shaper
   control proxy-scoped instead of writing it into MCP-only configuration.
3. Replace invalid Headroom metric fallbacks with currently supported,
   machine-readable behavior.
4. Add RTK per-agent verification checks and label instruction-only hosts as
   guidance rather than transparent hooks.

## Manual verification now

For Headroom MCP-only use, restart the host and verify that the Headroom tools
are listed, then deliberately invoke a compression/retrieval workflow. For
automatic proxy compression, start `headroom proxy` or launch the host with a
supported `headroom wrap` command; only then should `headroom perf --format
json` show nonzero proxy requests.

For RTK, `rtk gain --all --format json` verifies collected gains. Test Claude,
OpenCode, and Pi with a normally issued shell command such as `git status` in a
fresh session. On Codex and Antigravity, verify that their RTK instruction/rule
is loaded and that the agent actually chooses `rtk git status`; upstream does
not provide transparent interception for those two hosts.
