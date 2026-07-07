import { describe, expect, it } from "vitest";
import {
  computeDayStatuses,
  todayInTimezone,
} from "../src/lib/planStatus.js";

const s = (
  id: number,
  plannedDate: string,
  statusOverride: string | null = null,
  completedWorkoutId: number | null = null,
) => ({ id, plannedDate, statusOverride, completedWorkoutId });

describe("todayInTimezone", () => {
  it("handles the UTC/PT date boundary", () => {
    const lateEveningPT = new Date("2026-07-07T04:30:00Z"); // 9:30pm Jul 6 PT
    expect(todayInTimezone("America/Los_Angeles", lateEveningPT)).toBe("2026-07-06");
    expect(todayInTimezone(null, lateEveningPT)).toBe("2026-07-07");
  });
});

describe("computeDayStatuses", () => {
  const today = "2026-07-10";

  it("classifies today/upcoming/missed with no workouts", () => {
    const r = computeDayStatuses(
      [s(1, "2026-07-10"), s(2, "2026-07-12"), s(3, "2026-07-08")],
      [],
      today,
    );
    expect(r.get(1)).toBe("today");
    expect(r.get(2)).toBe("upcoming");
    expect(r.get(3)).toBe("missed");
  });

  it("explicit link and overrides win", () => {
    const r = computeDayStatuses(
      [s(1, "2026-07-08", null, 44), s(2, "2026-07-08", "skipped"), s(3, "2026-07-08", "moved")],
      [44],
      today,
    );
    expect(r.get(1)).toBe("completed");
    expect(r.get(2)).toBe("skipped");
    expect(r.get(3)).toBe("moved");
  });

  it("soft-completes unlinked sessions from spare workouts, one each", () => {
    // two sessions planned, only one workout done that day
    const r = computeDayStatuses(
      [s(1, "2026-07-08"), s(2, "2026-07-08")],
      [90],
      today,
    );
    const statuses = [r.get(1), r.get(2)].sort();
    expect(statuses).toEqual(["completed", "missed"]);
  });

  it("a linked workout can't also soft-complete another session", () => {
    const r = computeDayStatuses(
      [s(1, "2026-07-08", null, 90), s(2, "2026-07-08")],
      [90], // only the claimed workout exists
      today,
    );
    expect(r.get(1)).toBe("completed");
    expect(r.get(2)).toBe("missed");
  });

  it("soft-completion also applies to today's sessions", () => {
    const r = computeDayStatuses([s(1, "2026-07-10")], [7], today);
    expect(r.get(1)).toBe("completed");
  });
});
