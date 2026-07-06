import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import * as schema from "../src/db/schema.js";
import type { Db } from "../src/db/index.js";
import { createMcpServer } from "../src/server.js";

let client: Client;

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
  const data = text ? JSON.parse(text) : null;
  if (result.isError) throw new Error(`${name}: ${data?.error ?? text}`);
  return data;
}

beforeAll(async () => {
  const pglite = new PGlite();
  const db = drizzle(pglite, { schema });
  await migrate(db, { migrationsFolder: "drizzle" });

  const server = createMcpServer(db as unknown as Db);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
});

describe("WorkoutGuide MCP end-to-end", () => {
  it("configures exercises with settings-aware defaults", async () => {
    await call("set_setting", { key: "default_rest_seconds", value: "20" });
    const pushups = await call("add_exercise", {
      name: "Push-ups",
      durationSeconds: 30,
      restAfterSeconds: 25,
    });
    expect(pushups.id).toBe(1);
    const squats = await call("add_exercise", { name: "Squats", durationSeconds: 40 });
    expect(squats.restAfterSeconds).toBe(20); // from default_rest_seconds setting

    const today = await call("get_todays_exercises");
    expect(today.map((e: { name: string }) => e.name)).toEqual([
      "Push-ups",
      "Squats",
    ]);
  });

  it("rejects invalid setting values and unknown keys", async () => {
    await expect(call("set_setting", { key: "units", value: "parsecs" })).rejects.toThrow();
    await expect(
      call("set_setting", { key: "favorite_color", value: "red" }),
    ).rejects.toThrow();
  });

  it("runs a full workout flow with server-clock timing", async () => {
    const workout = await call("start_workout");
    expect(workout.workoutHistoryId).toBe(1);

    // duplicate start resumes rather than forking a second session
    const again = await call("start_workout");
    expect(again.workoutHistoryId).toBe(1);
    expect(again.note).toContain("resumed");

    const started = await call("start_exercise", { exerciseId: 1 });
    expect(started.lastSession).toBeNull();
    expect(started.exercise.plannedDurationSeconds).toBe(30);
    expect(started.workoutHistoryId).toBe(1);

    const working = await call("check_time", { exerciseId: 1 });
    expect(working.phase).toBe("working");
    expect(working.plannedSeconds).toBe(30);
    expect(working.remainingSeconds).toBeLessThanOrEqual(30);

    const ended = await call("end_exercise", {
      exerciseId: 1,
      actualDurationSeconds: 28,
    });
    expect(ended.endedEarly).toBe(false); // within 2s tolerance of 30

    await call("log_feedback", { exerciseId: 1, repsText: "12", feedbackText: "felt easy" });

    await call("start_rest", { exerciseId: 1 });
    const resting = await call("check_time", { exerciseId: 1 });
    expect(resting.phase).toBe("resting");
    expect(resting.plannedSeconds).toBe(25);

    const rested = await call("end_rest", { exerciseId: 1, actualRestSeconds: 40 });
    expect(rested.restExtended).toBe(true); // 40 > 25 + 5

    const done = await call("complete_workout", { workoutHistoryId: 1 });
    expect(done.exercisesCompleted).toBe(1);
    expect(done.completedAt).toBeTruthy();

    const streak = await call("get_streak");
    expect(streak.streakDays).toBe(1);
  });

  it("surfaces last-session data on the next attempt", async () => {
    const started = await call("start_exercise", { exerciseId: 1 });
    expect(started.lastSession.repsText).toBe("12");
    expect(started.lastSession.actualDurationSeconds).toBe(28);
    await call("end_exercise", { exerciseId: 1, actualDurationSeconds: 15, endedEarly: true });
    await call("end_rest", { exerciseId: 1, actualRestSeconds: 20 });

    const progress = await call("get_progress_summary", { exerciseId: 1 });
    expect(progress.sessions).toHaveLength(2);
    expect(progress.sessions[0].endedEarly).toBe(true); // newest first
  });

  it("merges daily metrics per-field across sources", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await call("log_daily_metrics", {
      date: today,
      recoveryScore: 62,
      dayStrain: 11.4,
      source: "whoop",
    });
    const merged = await call("log_daily_metrics", {
      date: today,
      hrvMs: 48,
      restingHr: 51,
      sleepDurationMinutes: 462,
      source: "apple_health",
    });
    expect(merged.recoveryScore).toBe(62); // whoop field survives
    expect(merged.hrvMs).toBe(48);
    expect(merged.source).toBe("apple_health");

    const rejected = await call("log_daily_metrics", {
      date: today,
      hrvMs: 99,
      source: "manual",
    });
    expect(rejected.hrvMs).toBe(48); // manual can't overwrite apple_health
    expect(rejected.mergeNote).toContain("no fields changed");

    const fetched = await call("get_daily_metrics", {});
    expect(fetched.hrvMs).toBe(48);
    expect(fetched.dayStrain).toBe(11.4);
  });

  it("attaches workout metrics idempotently via externalActivityId", async () => {
    const attached = await call("attach_workout_metrics", {
      workoutHistoryId: 1,
      avgHeartrate: 132,
      maxHeartrate: 171,
      calories: 210,
      workoutStrain: 9.7,
      externalActivityId: "whoop-abc-1",
      source: "whoop",
    });
    expect(attached.avgHeartrate).toBe(132);
    expect(attached.workoutStrain).toBe(9.7);

    const w2 = await call("start_workout");
    const dup = await call("attach_workout_metrics", {
      workoutHistoryId: w2.workoutHistoryId,
      avgHeartrate: 999,
      externalActivityId: "whoop-abc-1",
      source: "whoop",
    });
    expect(dup.deduped).toBe(true);
    await call("complete_workout", { workoutHistoryId: w2.workoutHistoryId });
  });

  it("builds a readiness context in one call", async () => {
    const ctx = await call("get_readiness_context");
    expect(ctx.today.hrvMs).toBe(48);
    expect(ctx.lastWorkout).toBeTruthy();
    expect(ctx.streakDays).toBe(1);
    expect(ctx.baseline7d.daysWithData).toBe(0); // only today has data
  });

  it("saves and switches templates, preserving logged history", async () => {
    const saved = await call("save_template", { name: "Original" });
    expect(saved.exerciseCount).toBe(2);

    await call("add_exercise", { name: "Plank", durationSeconds: 60 });
    await call("update_exercise", { id: 2, durationSeconds: 45 });

    const switched = await call("switch_template", { id: saved.id });
    // Push-ups has logs → updated; Squats untouched-but-matching → updated;
    // Plank has no logs → deleted
    expect(switched.updated).toBe(2);
    expect(switched.deleted).toBe(1);
    expect(switched.retired).toBe(0);

    const list = await call("list_exercises", {});
    expect(list.map((e: { name: string }) => e.name).sort()).toEqual([
      "Push-ups",
      "Squats",
    ]);
    const squats = list.find((e: { name: string }) => e.name === "Squats");
    expect(squats.durationSeconds).toBe(40); // template snapshot restored

    // deleting an exercise with history retires it instead
    const del = await call("delete_exercise", { id: 1 });
    expect(del.action).toBe("retired");
    const remaining = await call("get_todays_exercises");
    expect(remaining.map((e: { name: string }) => e.name)).toEqual(["Squats"]);
    const withRetired = await call("list_exercises", { includeRetired: true });
    expect(withRetired).toHaveLength(2);
  });

  it("round-trips a full backup (replace-only, confirmation-gated)", async () => {
    const backup = await call("export_backup");
    expect(backup.kind).toBe("backup");
    expect(backup.exercises.length).toBe(2);
    expect(backup.history.length).toBe(2);
    // the second Push-ups attempt ran outside any session → preserved as a loose log
    expect(backup.looseLogs.length).toBe(1);
    expect(backup.dailyMetrics.length).toBe(1);

    const payloadJson = JSON.stringify(backup);
    const preview = await call("import_backup", { payloadJson });
    expect(preview.warning).toContain("REPLACES everything");

    // mutate, then restore
    await call("add_exercise", { name: "Burpees" });
    const restored = await call("import_backup", { payloadJson, confirm: true });
    expect(restored.restored.exercises).toBe(2);

    const list = await call("list_exercises", { includeRetired: true });
    expect(list.map((e: { name: string }) => e.name).sort()).toEqual([
      "Push-ups",
      "Squats",
    ]);
    const pushups = list.find((e: { name: string }) => e.name === "Push-ups");
    expect(pushups.retiredAt).toBeTruthy(); // retirement survived the roundtrip

    const history = await call("get_history", {});
    expect(history).toHaveLength(2);
    expect(history[1].logs.length).toBe(1);
    expect(history[1].workoutStrain).toBe(9.7);

    // both attempts (session-bound + loose) power last-time callouts again
    const progress = await call("get_progress_summary", { exerciseId: pushups.id });
    expect(progress.sessions).toHaveLength(2);

    const streak = await call("get_streak");
    expect(streak.streakDays).toBe(1);
  });

  it("strips voice lines from shareable exports unless asked", async () => {
    // ids were renumbered by the restore — look Squats up by name
    const list = await call("list_exercises", {});
    const squatsId = list.find((e: { name: string }) => e.name === "Squats").id;
    await call("update_exercise", { id: squatsId, voiceStart: "Let's go!" });
    const bare = await call("export_shareable_config", {});
    expect(bare.kind).toBe("shareable_config");
    expect(bare.exercises[0].voiceStart).toBeUndefined();
    expect(bare.exercises[0].imageData).toBeUndefined();

    const withVoice = await call("export_shareable_config", { includeVoiceLines: true });
    expect(withVoice.exercises[0].voiceStart).toBe("Let's go!");

    // additive import: preview then confirm
    const payloadJson = JSON.stringify(withVoice);
    const preview = await call("import_shareable_config", { payloadJson });
    expect(preview.preview.willUpdateExercises).toContain("Squats");
    const applied = await call("import_shareable_config", { payloadJson, confirm: true });
    expect(applied.updatedExercises).toContain("Squats");
  });
});
