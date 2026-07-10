import type { AgentId, ToolId } from "@dont-waste/catalog";
import type { OperationPlan } from "@dont-waste/adapters";

export type PlanSummaryInput = {
  profile: string;
  selectedAgents: AgentId[];
  plans: OperationPlan[];
};

export type AgentPlanRow = {
  agent: AgentId;
  tools: ToolId[];
  files: string[];
  restartRequired: boolean;
  compatibility: string[];
  reversal: string[];
  notes: string[];
};

const restartHints: Partial<Record<ToolId, string>> = {
  headroom: "Restart the agent session so MCP/config changes load",
  rtk: "Open a new agent session so RTK hooks apply",
  caveman: "Open a new agent session so Caveman mode/hooks apply",
  ponytail: "Restart the agent / trust hooks where required (Codex)",
};

const reversalHints: Partial<Record<ToolId, string>> = {
  headroom:
    "dont-waste uninstall removes marker-owned MCP blocks; use rollback <id> for snapshots",
  rtk: "RTK has no generic uninstall; restore snapshots with dont-waste rollback",
  caveman: "dont-waste uninstall removes .caveman-active markers only",
  ponytail:
    "dont-waste uninstall removes owned config/plugin entries; preserve user plugins",
};

function pathTouchesAgent(file: string, agent: AgentId): boolean {
  const lower = file.toLowerCase();
  const token =
    agent === "claude-code"
      ? "claude"
      : agent === "gemini-cli"
        ? "gemini"
        : agent === "copilot-cli"
          ? "copilot"
          : agent === "antigravity-cli"
            ? "antigravity"
            : agent;
  return lower.includes(agent) || lower.includes(token);
}

export function summarizePlanByAgent(input: PlanSummaryInput): AgentPlanRow[] {
  if (!input.selectedAgents.length) {
    return [
      {
        agent: "codex",
        tools: input.plans.map((plan) => plan.tool),
        files: [...new Set(input.plans.flatMap((plan) => plan.affectedPaths))],
        restartRequired: false,
        compatibility: [
          "install-only profile: no agent integrations will be activated",
        ],
        reversal: ["No agent configs written in install-only mode"],
        notes: [
          "Advanced controls (CCR/TTL/cavecrew/MCP-shrink) are not exposed in this TUI yet",
        ],
      },
    ];
  }

  return input.selectedAgents.map((agent) => {
    const tools = input.plans.map((plan) => plan.tool);
    const files = [
      ...new Set(
        input.plans.flatMap((plan) =>
          plan.affectedPaths.filter((file) => pathTouchesAgent(file, agent)),
        ),
      ),
    ];
    const compatibility = input.plans.flatMap((plan) => {
      const capability = plan.capabilities.find((item) => item.agent === agent);
      if (!capability) return [`${plan.tool}: no capability row for ${agent}`];
      return [
        `${plan.tool}: ${capability.capability.installMethod} · metrics=${capability.capability.supportsMetrics}`,
      ];
    });
    const reversal = tools
      .map((tool) => reversalHints[tool])
      .filter((item): item is string => Boolean(item));
    const notes = [
      ...input.plans.flatMap((plan) =>
        plan.warnings
          .filter((warning) => warning.toLowerCase().includes(agent))
          .slice(0, 1),
      ),
      ...tools
        .map((tool) => restartHints[tool])
        .filter((item): item is string => Boolean(item)),
      "Advanced controls not in this menu: CCR/TTL, cavecrew, MCP-shrink, learn --verbosity",
    ];
    return {
      agent,
      tools,
      files,
      restartRequired: tools.some((tool) => Boolean(restartHints[tool])),
      compatibility: [...new Set(compatibility)],
      reversal: [...new Set(reversal)],
      notes: [...new Set(notes)],
    };
  });
}

export function formatPlanSummary(input: PlanSummaryInput): string {
  const rows = summarizePlanByAgent(input);
  const toolBlocks = input.plans
    .map((item) => {
      const commands =
        item.commands
          .map(
            (command) =>
              `  ${command.interactive ? "[interactive/launch-only] " : ""}${command.command} ${command.args.join(" ")}`,
          )
          .join("\n") || "  already installed / no command";
      const files = item.affectedPaths.length
        ? `\n  files:\n${item.affectedPaths.map((file) => `    - ${file}`).join("\n")}`
        : "";
      const warnings = item.warnings.length
        ? `\n  warnings: ${item.warnings.join(" · ")}`
        : "";
      return `${item.tool}:\n${commands}${files}${warnings}`;
    })
    .join("\n\n");

  const agentTable = rows.length
    ? rows
        .map((row) => {
          const files = row.files.length
            ? row.files.map((file) => `    - ${file}`).join("\n")
            : "    - (tool-global / none yet)";
          return [
            `${row.agent}`,
            `  tools: ${row.tools.join(", ") || "none"}`,
            `  restart: ${row.restartRequired ? "yes" : "no"}`,
            `  files:\n${files}`,
            row.compatibility.length
              ? `  compatibility: ${row.compatibility.join(" · ")}`
              : "",
            row.reversal.length
              ? `  reversal: ${row.reversal.join(" · ")}`
              : "",
            row.notes.length ? `  notes: ${row.notes.join(" · ")}` : "",
          ]
            .filter(Boolean)
            .join("\n");
        })
        .join("\n\n")
    : "none (install-only)";

  return `Profile: ${input.profile}\nAgents: ${input.selectedAgents.join(", ") || "none (install-only)"}\n\nPer-agent impact:\n${agentTable}\n\nCommands:\n${toolBlocks}`;
}
