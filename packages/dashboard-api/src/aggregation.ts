import type { MetricEvent } from "@dont-waste/telemetry";

export type DailyBucket = {
  day: string;
  measuredSaved: number;
  estimatedSaved: number;
  events: number;
};

export type WeeklyBucket = {
  week: string;
  measuredSaved: number;
  estimatedSaved: number;
  events: number;
};

function savings(event: MetricEvent): number {
  if (event.tokensSaved !== null) return event.tokensSaved;
  if (event.tokensBefore !== null && event.tokensAfter !== null) return event.tokensBefore - event.tokensAfter;
  return 0;
}

function isoWeek(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utc.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function aggregateDaily(events: MetricEvent[]): DailyBucket[] {
  const buckets = new Map<string, DailyBucket>();
  for (const event of events) {
    const day = event.occurredAt.slice(0, 10);
    const current = buckets.get(day) ?? { day, measuredSaved: 0, estimatedSaved: 0, events: 0 };
    current.events += 1;
    if (event.confidence === "measured") current.measuredSaved += savings(event);
    if (event.confidence === "estimated") current.estimatedSaved += savings(event);
    buckets.set(day, current);
  }
  return [...buckets.values()].sort((left, right) => left.day.localeCompare(right.day));
}

export function aggregateWeekly(events: MetricEvent[]): WeeklyBucket[] {
  const buckets = new Map<string, WeeklyBucket>();
  for (const event of events) {
    const week = isoWeek(event.occurredAt.slice(0, 10));
    const current = buckets.get(week) ?? { week, measuredSaved: 0, estimatedSaved: 0, events: 0 };
    current.events += 1;
    if (event.confidence === "measured") current.measuredSaved += savings(event);
    if (event.confidence === "estimated") current.estimatedSaved += savings(event);
    buckets.set(week, current);
  }
  return [...buckets.values()].sort((left, right) => left.week.localeCompare(right.week));
}
