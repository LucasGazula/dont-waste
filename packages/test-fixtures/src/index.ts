export const agentConfigFixtures = {
  codex: 'model = "gpt-5"\n[mcp_servers.existing]\ncommand = "example"\n',
  "claude-code": JSON.stringify({
    hooks: {},
    permissions: { allow: ["Read"] },
  }),
  "gemini-cli": JSON.stringify({
    theme: "dark",
    mcpServers: { existing: { command: "example" } },
  }),
  "copilot-cli": JSON.stringify({ trustedFolders: ["~/work"] }),
  "antigravity-cli": JSON.stringify({ extensions: [] }),
  opencode: JSON.stringify({ plugin: ["existing-plugin"] }),
  pi: JSON.stringify({ theme: "dark" }),
} as const;

/** Sanitized shape inspired by `rtk gain --all --format json`. No prompts/outputs. */
export const rtkGainFixture = JSON.stringify({
  history: [
    {
      timestamp: "2026-07-09T12:00:00.000Z",
      command: "git status",
      original_tokens: 1000,
      optimized_tokens: 200,
      project: "/work/demo",
      flow_id: "rtk-flow-1",
      agent: "codex",
      session_id: "sess-rtk-1",
      model: "gpt-5",
      cost_before: 0.02,
      cost_after: 0.004,
    },
    {
      timestamp: "2026-07-09T12:01:00.000Z",
      command: "vitest",
      original_tokens: 500,
      optimized_tokens: 100,
      flow_id: "rtk-flow-2",
      project: "/work/demo",
    },
  ],
});

/** Sanitized shape inspired by Headroom perf/export JSON. */
export const headroomPerfFixture = JSON.stringify({
  events: [
    {
      timestamp: "2026-07-09T12:02:00.000Z",
      input_tokens_before: 300,
      input_tokens_after: 100,
      flow_id: "headroom-flow",
      measured: true,
      agent: "claude-code",
      session_id: "sess-hr-1",
      project: "/work/demo",
    },
  ],
});

/** Output-savings style events are estimated unless holdout/measured is set. */
export const headroomOutputSavingsFixture = JSON.stringify({
  events: [
    {
      timestamp: "2026-07-09T12:03:00.000Z",
      type: "output-savings",
      tokens_before: 800,
      tokens_after: 500,
      measured: false,
    },
    {
      timestamp: "2026-07-09T12:04:00.000Z",
      type: "output-savings",
      tokens_before: 400,
      tokens_after: 200,
      measured: true,
      holdout: true,
    },
  ],
});

/** Benchmark-reference style event (never enters measured totals). */
export const headroomBenchmarkFixture = JSON.stringify({
  events: [
    {
      timestamp: "2026-07-09T12:05:00.000Z",
      type: "benchmark-reference",
      tokens_before: 1000,
      tokens_after: 400,
      tokens_saved: 600,
      confidence: "unavailable",
      model: "benchmark-suite",
    },
  ],
});

/** Explicit user-exported Caveman stats text — never scraped from conversations. */
export const cavemanStatsFixture = [
  "Session reduction: 42%",
  "12,400 tokens saved",
].join("\n");

/** Malicious/noisy payload used to assert privacy stripping. */
export const privacyHostileFixture = JSON.stringify({
  events: [
    {
      timestamp: "2026-07-09T12:06:00.000Z",
      original_tokens: 100,
      optimized_tokens: 40,
      prompt: "SECRET PROMPT TEXT",
      output: "SECRET OUTPUT TEXT",
      conversation: "do not store me",
      command: "ls",
      flow_id: "privacy-flow",
    },
  ],
});
