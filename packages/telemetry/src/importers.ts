import { createHash } from "node:crypto";
import { z } from "zod";
import type { MetricEvent } from "./metrics.js";

const looseRecord = z.record(z.unknown());
const numberFrom = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
const firstNumber = (record: Record<string, unknown>, keys: string[]): number | null => {
  for (const key of keys) {
    const value = numberFrom(record[key]);
    if (value !== null) return value;
  }
  return null;
};
const stableId = (prefix: string, item: unknown): string => `${prefix}-${createHash("sha256").update(JSON.stringify(item)).digest("hex").slice(0, 24)}`;

function recordsFrom(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => looseRecord.safeParse(item).success);
  if (!looseRecord.safeParse(value).success) return [];
  const object = value as Record<string, unknown>;
  for (const key of ["events", "history", "commands", "records", "data", "results"]) {
    if (Array.isArray(object[key])) return recordsFrom(object[key]);
  }
  return [object];
}

export function importRtkJson(raw: string, now = new Date()): MetricEvent[] {
  const parsed: unknown = JSON.parse(raw);
  return recordsFrom(parsed).flatMap((record) => {
    const before = firstNumber(record, ["tokens_before", "original_tokens", "before_tokens", "input_tokens", "raw_tokens"]);
    const after = firstNumber(record, ["tokens_after", "optimized_tokens", "after_tokens", "output_tokens", "compact_tokens"]);
    const saved = firstNumber(record, ["tokens_saved", "saved_tokens", "savings"]);
    if (before === null && after === null && saved === null) return [];
    const effectiveBefore = before ?? (after !== null && saved !== null ? after + saved : null);
    const effectiveAfter = after ?? (before !== null && saved !== null ? before - saved : null);
    return [{
      id: stableId("rtk", record), occurredAt: String(record.timestamp ?? record.created_at ?? now.toISOString()), tool: "rtk",
      metricType: "command-output", tokensBefore: effectiveBefore, tokensAfter: effectiveAfter,
      tokensSaved: saved ?? (effectiveBefore !== null && effectiveAfter !== null ? effectiveBefore - effectiveAfter : null), confidence: "measured",
      sourceDepth: 0, overlapKey: typeof record.flow_id === "string" ? record.flow_id : undefined,
      projectPath: typeof record.project === "string" ? record.project : undefined,
      evidence: typeof record.command === "string" ? `rtk:${record.command}` : "rtk gain export",
    } satisfies MetricEvent];
  });
}

export function importHeadroomJson(raw: string, now = new Date()): MetricEvent[] {
  const parsed: unknown = JSON.parse(raw);
  return recordsFrom(parsed).flatMap((record) => {
    const before = firstNumber(record, ["tokens_before", "input_tokens_before", "original_tokens", "before"]);
    const after = firstNumber(record, ["tokens_after", "input_tokens_after", "compressed_tokens", "after"]);
    const saved = firstNumber(record, ["tokens_saved", "saved_tokens", "savings"]);
    if (before === null && after === null && saved === null) return [];
    const output = Boolean(record.output || record.metric_type === "output" || record.type === "output-savings");
    const confidence = record.measured === true || record.confidence === "measured" ? "measured" : output ? "estimated" : "measured";
    const effectiveBefore = before ?? (after !== null && saved !== null ? after + saved : null);
    const effectiveAfter = after ?? (before !== null && saved !== null ? before - saved : null);
    return [{
      id: stableId("headroom", record), occurredAt: String(record.timestamp ?? record.created_at ?? now.toISOString()), tool: "headroom",
      metricType: output ? "estimated-output" : "input", tokensBefore: effectiveBefore, tokensAfter: effectiveAfter,
      tokensSaved: saved ?? (effectiveBefore !== null && effectiveAfter !== null ? effectiveBefore - effectiveAfter : null), confidence,
      sourceDepth: Number(record.source_depth ?? 1), overlapKey: typeof record.flow_id === "string" ? record.flow_id : undefined,
      evidence: "headroom perf/output-savings",
    } satisfies MetricEvent];
  });
}

export function importCavemanStats(raw: string, now = new Date()): MetricEvent[] {
  const percent = Number(raw.match(/(?:reduction|saved|savings)[^0-9]*(\d+(?:\.\d+)?)\s*%/i)?.[1]);
  const saved = Number(raw.match(/([\d,.]+)\s*(?:tokens?|tok)\s*saved/i)?.[1]?.replace(/,/g, ""));
  if (!Number.isFinite(percent) && !Number.isFinite(saved)) return [];
  const before = Number.isFinite(saved) && Number.isFinite(percent) && percent > 0 ? saved / (percent / 100) : null;
  return [{
    id: stableId("caveman", raw), occurredAt: now.toISOString(), tool: "caveman", metricType: "estimated-output",
    tokensBefore: before, tokensAfter: before !== null ? before - saved : null, tokensSaved: Number.isFinite(saved) ? saved : null,
    confidence: "estimated", sourceDepth: 0, evidence: "caveman-stats local estimate",
  }];
}
