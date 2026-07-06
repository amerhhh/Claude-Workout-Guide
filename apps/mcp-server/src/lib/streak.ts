function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Consecutive days (ending today or yesterday) with at least one completed
 * workout. Ported from the prototype's web lib.
 */
export function computeStreak(
  completedAts: Date[],
  now: Date = new Date(),
): number {
  const completedDays = new Set(completedAts.map((d) => dayKey(d)));
  if (completedDays.size === 0) return 0;

  let streak = 0;
  const cursor = new Date(now);
  if (!completedDays.has(dayKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!completedDays.has(dayKey(cursor))) return 0;
  }
  while (completedDays.has(dayKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
