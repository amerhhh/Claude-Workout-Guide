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

const day = (offset: number) =>
  new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

beforeAll(async () => {
  const pglite = new PGlite();
  const db = drizzle(pglite, { schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  const server = createMcpServer(db as unknown as Db);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(st), client.connect(ct)]);
});

describe("ideas", () => {
  it("logs, searches, and deletes ideas", async () => {
    const a = await call("log_idea", { content: "Pitch BHAI dashboard as a coach", context: "run" });
    expect(a.linkedToWorkout).toBeNull(); // no active session
    await call("log_idea", { content: "Buy new running shoes" });

    const found = await call("list_ideas", { search: "bhai" });
    expect(found).toHaveLength(1);
    expect(found[0].context).toBe("run");

    await call("delete_idea", { id: found[0].id });
    expect(await call("list_ideas", {})).toHaveLength(1);
  });
});

describe("training plans & calendar", () => {
  let planId: number;

  it("imports a plan with preview → confirm", async () => {
    const payload = JSON.stringify({
      version: 1,
      kind: "training_plan",
      planName: "Fall 10k",
      category: "running",
      sessions: [
        { date: day(-1), title: "Easy 5k", timeOfDay: "morning" },
        { date: day(0), title: "Intervals 6x400" },
        { date: day(2), title: "Long run 6k", plannedTime: "07:30" },
      ],
    });
    const preview = await call("import_training_plan", { payloadJson: payload });
    expect(preview.preview.sessions).toBe(3);

    const imported = await call("import_training_plan", { payloadJson: payload, confirm: true });
    planId = imported.planId;
    expect(imported.imported.category).toBe("running");
  });

  it("computes missed/today/upcoming statuses in the calendar", async () => {
    const cal = await call("get_calendar", { fromDate: day(-1), toDate: day(3) });
    const all = Object.values(cal.days).flat() as Array<{ title: string; status: string }>;
    expect(all.find((s) => s.title === "Easy 5k")!.status).toBe("missed");
    expect(all.find((s) => s.title === "Intervals 6x400")!.status).toBe("today");
    expect(all.find((s) => s.title === "Long run 6k")!.status).toBe("upcoming");
  });

  it("readiness context lists today's planned sessions", async () => {
    const ctx = await call("get_readiness_context");
    expect(ctx.todaysPlannedSessions).toHaveLength(1);
    expect(ctx.todaysPlannedSessions[0].title).toBe("Intervals 6x400");
    expect(ctx.todaysPlannedSessions[0].done).toBe(false);
  });

  it("auto-links a completed workout to today's single due session", async () => {
    await call("add_exercise", { name: "Run", durationSeconds: 60 });
    const w = await call("start_workout");
    await call("start_exercise", { exerciseId: 1 });
    await call("end_exercise", { exerciseId: 1, actualDurationSeconds: 60 });
    const done = await call("complete_workout", { workoutHistoryId: w.workoutHistoryId });
    expect(done.linkedPlannedSession.title).toBe("Intervals 6x400");

    const cal = await call("get_calendar", { fromDate: day(0), toDate: day(0) });
    const todays = Object.values(cal.days).flat() as Array<{ status: string }>;
    expect(todays[0].status).toBe("completed");
  });

  it("scores adherence: skipped doesn't count against you", async () => {
    // skip yesterday's missed session deliberately
    const cal = await call("get_calendar", { fromDate: day(-1), toDate: day(-1) });
    const missed = (Object.values(cal.days).flat() as Array<{ id: number }>)[0];
    await call("update_planned_session", { id: missed.id, statusOverride: "skipped" });

    const adh = await call("get_plan_adherence", { planId });
    expect(adh.overall.completed).toBe(1);
    expect(adh.overall.missed).toBe(0);
    expect(adh.overall.skipped).toBe(1);
    expect(adh.overall.completionRate).toBe(100);
    expect(adh.perPlan["Fall 10k"].completed).toBe(1);
  });

  it("pausing a plan hides it from the calendar", async () => {
    await call("set_plan_active", { id: planId, active: false });
    const cal = await call("get_calendar", { fromDate: day(-1), toDate: day(3) });
    expect(Object.keys(cal.days)).toHaveLength(0);
    await call("set_plan_active", { id: planId, active: true });
  });

  it("backs up and restores ideas + plans with links intact", async () => {
    const backup = await call("export_backup");
    expect(backup.ideas).toHaveLength(1);
    expect(backup.plans).toHaveLength(1);
    expect(backup.plans[0].sessions).toHaveLength(3);
    const linked = backup.plans[0].sessions.find(
      (s: { completedWorkoutStartedAt: string | null }) => s.completedWorkoutStartedAt,
    );
    expect(linked.title).toBe("Intervals 6x400");

    await call("import_backup", { payloadJson: JSON.stringify(backup), confirm: true });

    const adh = await call("get_plan_adherence", {});
    expect(adh.overall.completed).toBe(1); // link survived via startedAt mapping
    expect(await call("list_ideas", {})).toHaveLength(1);
  });
});
