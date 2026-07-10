import type { DontWasteConfig } from "@dont-waste/core";
import { aggregateEvents, type MetricEvent } from "@dont-waste/telemetry";
import { aggregateDaily, aggregateWeekly } from "./aggregation.js";
import { costTotals, overlapGroups } from "./filters.js";

/** Data transfer shape shared by the local API and the dashboard SPA. */
export function dashboardOverview(config: DontWasteConfig, events: MetricEvent[], extras: {
  projects?: Array<{ path: string; alias: string | null }>;
  sessions?: Array<{ id: string; agent: string | null; projectPath: string | null }>;
} = {}) {
  const summary = aggregateEvents(events);
  return {
    summary,
    daily: aggregateDaily(events),
    weekly: aggregateWeekly(events),
    costs: costTotals(events),
    overlaps: overlapGroups(events),
    privacy: {
      storesPrompts: false,
      storesOutputs: false,
      note: "Don’t Waste stores only local installation state and token metrics.",
    },
    activeTools: Object.entries(config.integrations).flatMap(([agent, tools]) => Object.entries(tools)
      .filter(([, setting]) => setting.enabled)
      .map(([tool, setting]) => ({ agent, tool, mode: setting.mode }))),
    projects: extras.projects ?? config.projects.map((project) => ({
      path: config.displayProjectPaths ? project.path : undefined,
      alias: project.alias ?? "Local project",
    })),
    sessions: extras.sessions ?? [],
  };
}
