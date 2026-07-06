import { METRIC_SOURCE_PRIORITY } from "@workoutguide/shared";

export function priorityOf(source: string): number {
  return METRIC_SOURCE_PRIORITY[source] ?? 1;
}

export const MERGEABLE_FIELDS = [
  "recoveryScore",
  "hrvMs",
  "restingHr",
  "sleepPerformance",
  "sleepDurationMinutes",
  "dayStrain",
] as const;
export type MergeableField = (typeof MERGEABLE_FIELDS)[number];

export type MetricFields = { [K in MergeableField]?: number | null };

export interface MetricRow extends MetricFields {
  source: string;
  rawJson?: string | null;
}

export interface MergeResult {
  fields: MetricFields;
  source: string;
  rawJson: string | null;
  wroteAnyField: boolean;
}

/**
 * Per-field merge per SPEC §5b: an incoming value lands when the slot is empty
 * or the incoming source ranks at least as high as the source recorded on the
 * row. Fields the incoming payload doesn't provide (undefined OR null) are
 * never erased — so Apple Health HRV and a Whoop recovery score coexist.
 * rawJson always keeps the latest full payload; row source records the last
 * writer that actually landed a field.
 */
export function mergeDailyMetrics(
  existing: MetricRow | null,
  incoming: MetricRow,
): MergeResult {
  if (!existing) {
    const fields: MetricFields = {};
    for (const f of MERGEABLE_FIELDS) {
      if (incoming[f] !== undefined) fields[f] = incoming[f];
    }
    return {
      fields,
      source: incoming.source,
      rawJson: incoming.rawJson ?? null,
      wroteAnyField: true,
    };
  }

  const incomingWins =
    priorityOf(incoming.source) >= priorityOf(existing.source);

  const fields: MetricFields = {};
  let wroteAnyField = false;
  for (const f of MERGEABLE_FIELDS) {
    const incomingValue = incoming[f];
    const existingValue = existing[f] ?? null;
    if (
      incomingValue !== undefined &&
      incomingValue !== null &&
      (existingValue === null || incomingWins)
    ) {
      fields[f] = incomingValue;
      if (incomingValue !== existingValue) wroteAnyField = true;
    } else {
      fields[f] = existingValue;
    }
  }

  return {
    fields,
    source: wroteAnyField ? incoming.source : existing.source,
    rawJson: incoming.rawJson ?? existing.rawJson ?? null,
    wroteAnyField,
  };
}
