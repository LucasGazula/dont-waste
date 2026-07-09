import type { DontWasteConfig } from "@dont-waste/core";
import { aggregateEvents, type MetricEvent } from "@dont-waste/telemetry";

/** Data transfer shape shared by the local API and the dashboard SPA. */
export function dashboardOverview(config: DontWasteConfig, events: MetricEvent[]) {
  return {
    summary: aggregateEvents(events),
    activeTools: Object.entries(config.integrations).flatMap(([agent, tools]) => Object.entries(tools)
      .filter(([, setting]) => setting.enabled)
      .map(([tool, setting]) => ({ agent, tool, mode: setting.mode }))),
  };
}
