import { describe, expect, it } from "vitest";
import { computeStreak } from "../src/lib/streak.js";

const day = (offset: number, now: Date) => {
  const d = new Date(now);
  d.setDate(d.getDate() + offset);
  return d;
};

describe("computeStreak", () => {
  const now = new Date("2026-07-05T20:00:00Z");

  it("returns 0 with no completions", () => {
    expect(computeStreak([], now)).toBe(0);
  });

  it("counts consecutive days ending today", () => {
    expect(computeStreak([day(0, now), day(-1, now), day(-2, now)], now)).toBe(3);
  });

  it("still counts a streak ending yesterday (today's workout not done yet)", () => {
    expect(computeStreak([day(-1, now), day(-2, now)], now)).toBe(2);
  });

  it("returns 0 when the last completion is 2+ days old", () => {
    expect(computeStreak([day(-2, now), day(-3, now)], now)).toBe(0);
  });

  it("stops at a gap and dedups multiple workouts per day", () => {
    expect(
      computeStreak([day(0, now), day(0, now), day(-1, now), day(-3, now)], now),
    ).toBe(2);
  });
});
