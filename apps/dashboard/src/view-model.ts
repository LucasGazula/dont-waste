export type EventFilters = {
  confidence: "all" | "measured" | "estimated" | "unavailable";
  tool: string;
  project: string;
  session: string;
};

export type FilterableEvent = {
  confidence: string;
  tool: string;
  projectPath?: string | undefined;
  sessionId?: string | undefined;
};

/** Client-side filter contract mirrored by /api/events query params (no Playwright in repo). */
export function applyEventFilters<T extends FilterableEvent>(
  events: T[],
  filters: EventFilters,
): T[] {
  return events.filter((event) => {
    if (filters.confidence !== "all" && event.confidence !== filters.confidence)
      return false;
    if (filters.tool !== "all" && event.tool !== filters.tool) return false;
    if (filters.project && !(event.projectPath ?? "").includes(filters.project))
      return false;
    if (filters.session !== "all" && event.sessionId !== filters.session)
      return false;
    return true;
  });
}
