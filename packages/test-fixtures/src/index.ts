export const agentConfigFixtures = {
  codex: "model = \"gpt-5\"\n[mcp_servers.existing]\ncommand = \"example\"\n",
  "claude-code": JSON.stringify({ hooks: {}, permissions: { allow: ["Read"] } }),
  "gemini-cli": JSON.stringify({ theme: "dark", mcpServers: { existing: { command: "example" } } }),
  "copilot-cli": JSON.stringify({ trustedFolders: ["~/work"] }),
  "antigravity-cli": JSON.stringify({ extensions: [] }),
  opencode: JSON.stringify({ plugin: ["existing-plugin"] }),
  pi: JSON.stringify({ theme: "dark" }),
} as const;

export const rtkGainFixture = JSON.stringify({
  history: [
    { timestamp: "2026-07-09T12:00:00.000Z", command: "git status", original_tokens: 1000, optimized_tokens: 200, project: "/work/demo" },
    { timestamp: "2026-07-09T12:01:00.000Z", command: "vitest", original_tokens: 500, optimized_tokens: 100 },
  ],
});

export const headroomPerfFixture = JSON.stringify({
  events: [{ timestamp: "2026-07-09T12:02:00.000Z", input_tokens_before: 300, input_tokens_after: 100, flow_id: "headroom-flow" }],
});
