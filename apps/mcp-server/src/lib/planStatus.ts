/** Session status is computed, never stored — retro-logged workouts flip
 *  "missed" to "completed" with zero bookkeeping. */

export type SessionStatus =
  | "completed"
  | "missed"
  | "today"
  | "upcoming"
  | "skipped"
  | "moved";

export interface StatusInput {
  id: number;
  plannedDate: string; // YYYY-MM-DD
  statusOverride: string | null;
  completedWorkoutId: number | null;
}

/** Local calendar date for an IANA timezone (default: server locale UTC). */
export function todayInTimezone(tz: string | null, now: Date = new Date()): string {
  if (!tz) return now.toISOString().slice(0, 10);
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now);
}

/**
 * Compute statuses for all sessions on ONE date.
 *
 * Explicit signals win: statusOverride, then completedWorkoutId. Remaining
 * unlinked sessions soft-complete against completed workouts on that date
 * that aren't already claimed by a linked session — so a workout logged
 * without linking (e.g. imported later) still counts, but one workout can't
 * tick two boxes.
 */
export function computeDayStatuses(
  sessions: StatusInput[],
  completedWorkoutIdsOnDate: number[],
  today: string,
): Map<number, SessionStatus> {
  const result = new Map<number, SessionStatus>();
  const claimed = new Set<number>();

  const pending: StatusInput[] = [];
  for (const s of sessions) {
    if (s.statusOverride === "skipped" || s.statusOverride === "moved") {
      result.set(s.id, s.statusOverride);
    } else if (s.statusOverride === "completed") {
      result.set(s.id, "completed");
    } else if (s.completedWorkoutId != null) {
      result.set(s.id, "completed");
      claimed.add(s.completedWorkoutId);
    } else {
      pending.push(s);
    }
  }

  let spareWorkouts = completedWorkoutIdsOnDate.filter(
    (id) => !claimed.has(id),
  ).length;

  for (const s of pending) {
    if (spareWorkouts > 0) {
      result.set(s.id, "completed");
      spareWorkouts--;
    } else if (s.plannedDate === today) {
      result.set(s.id, "today");
    } else if (s.plannedDate > today) {
      result.set(s.id, "upcoming");
    } else {
      result.set(s.id, "missed");
    }
  }
  return result;
}
