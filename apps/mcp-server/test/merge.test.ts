import { describe, expect, it } from "vitest";
import { mergeDailyMetrics, priorityOf } from "../src/lib/merge.js";

describe("priorityOf", () => {
  it("ranks apple_health > whoop > manual, unknown sources like manual", () => {
    expect(priorityOf("apple_health")).toBeGreaterThan(priorityOf("whoop"));
    expect(priorityOf("whoop")).toBeGreaterThan(priorityOf("manual"));
    expect(priorityOf("some_future_source")).toBe(priorityOf("manual"));
  });
});

describe("mergeDailyMetrics", () => {
  it("uses incoming values verbatim when no row exists", () => {
    const r = mergeDailyMetrics(null, {
      source: "manual",
      hrvMs: 55,
      sleepDurationMinutes: 420,
      rawJson: '{"a":1}',
    });
    expect(r.fields.hrvMs).toBe(55);
    expect(r.fields.sleepDurationMinutes).toBe(420);
    expect(r.source).toBe("manual");
    expect(r.rawJson).toBe('{"a":1}');
    expect(r.wroteAnyField).toBe(true);
  });

  it("lets Apple Health HRV and Whoop recovery score coexist (spec example)", () => {
    // whoop wrote first: recovery + strain
    const afterWhoop = mergeDailyMetrics(null, {
      source: "whoop",
      recoveryScore: 62,
      dayStrain: 11.4,
    });
    // apple_health arrives with HRV/RHR/sleep but no recovery score
    const r = mergeDailyMetrics(
      { ...afterWhoop.fields, source: afterWhoop.source },
      { source: "apple_health", hrvMs: 48, restingHr: 51, sleepDurationMinutes: 462 },
    );
    expect(r.fields.recoveryScore).toBe(62); // whoop's field untouched
    expect(r.fields.dayStrain).toBe(11.4);
    expect(r.fields.hrvMs).toBe(48);
    expect(r.source).toBe("apple_health"); // last writer that landed a field
  });

  it("does not let a lower-priority source overwrite an existing value", () => {
    const existing = { source: "apple_health", hrvMs: 48, restingHr: 51 };
    const r = mergeDailyMetrics(existing, {
      source: "manual",
      hrvMs: 99,
      recoveryScore: 55,
    });
    expect(r.fields.hrvMs).toBe(48); // manual < apple_health → rejected
    expect(r.fields.recoveryScore).toBe(55); // empty slot → filled
    expect(r.source).toBe("manual"); // it did land a field
  });

  it("lets an equal-priority source overwrite (fresher sync wins)", () => {
    const existing = { source: "whoop", recoveryScore: 40 };
    const r = mergeDailyMetrics(existing, { source: "whoop", recoveryScore: 45 });
    expect(r.fields.recoveryScore).toBe(45);
  });

  it("never erases fields via null/undefined and keeps row source when nothing landed", () => {
    const existing = {
      source: "apple_health",
      hrvMs: 48,
      restingHr: 51,
      rawJson: '{"old":true}',
    };
    const r = mergeDailyMetrics(existing, {
      source: "manual",
      hrvMs: null,
      restingHr: 40,
    });
    expect(r.fields.hrvMs).toBe(48); // null = not provided
    expect(r.fields.restingHr).toBe(51); // lower priority → rejected
    expect(r.wroteAnyField).toBe(false);
    expect(r.source).toBe("apple_health"); // unchanged — nothing landed
    expect(r.rawJson).toBe('{"old":true}');
  });

  it("keeps the latest full payload in rawJson even when fields are rejected", () => {
    const existing = { source: "apple_health", hrvMs: 48, rawJson: '{"old":true}' };
    const r = mergeDailyMetrics(existing, {
      source: "manual",
      hrvMs: 99,
      rawJson: '{"new":true}',
    });
    expect(r.fields.hrvMs).toBe(48);
    expect(r.rawJson).toBe('{"new":true}'); // latest payload always kept
  });
});
