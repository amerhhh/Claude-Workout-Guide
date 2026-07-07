import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { and, asc, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import {
  planCategorySchema,
  plannedSessionInputSchema,
  sessionStatusOverrideSchema,
  timeOfDaySchema,
  trainingPlanPayloadSchema,
} from "@workoutguide/shared";
import type { Db } from "../db/index.js";
import { plannedSessions, plans, workoutHistory } from "../db/schema.js";
import { ok, err } from "../lib/respond.js";
import {
  computeDayStatuses,
  todayInTimezone,
  type SessionStatus,
} from "../lib/planStatus.js";
import { getSettingValue } from "./config.js";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

async function getToday(db: Db): Promise<string> {
  const tz = (await getSettingValue(db, "timezone")) as string | null;
  return todayInTimezone(tz);
}

/** All sessions in range from active plans (or one plan), with computed statuses. */
async function sessionsWithStatuses(
  db: Db,
  fromDate: string,
  toDate: string,
  planId?: number,
) {
  const rows = await db
    .select({
      session: plannedSessions,
      planName: plans.name,
      planCategory: plans.category,
      planActive: plans.active,
    })
    .from(plannedSessions)
    .innerJoin(plans, eq(plannedSessions.planId, plans.id))
    .where(
      and(
        gte(plannedSessions.plannedDate, fromDate),
        lte(plannedSessions.plannedDate, toDate),
        planId != null ? eq(plans.id, planId) : eq(plans.active, true),
      ),
    )
    .orderBy(asc(plannedSessions.plannedDate), asc(plannedSessions.plannedTime));

  if (rows.length === 0) return [];

  const workouts = await db
    .select({
      id: workoutHistory.id,
      completedAt: workoutHistory.completedAt,
    })
    .from(workoutHistory)
    .where(isNotNull(workoutHistory.completedAt));
  const workoutsByDate = new Map<string, number[]>();
  for (const w of workouts) {
    const key = w.completedAt!.toISOString().slice(0, 10);
    workoutsByDate.set(key, [...(workoutsByDate.get(key) ?? []), w.id]);
  }

  const today = await getToday(db);
  const byDate = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = r.session.plannedDate;
    byDate.set(key, [...(byDate.get(key) ?? []), r]);
  }

  const statuses = new Map<number, SessionStatus>();
  for (const [date, dayRows] of byDate) {
    const dayStatuses = computeDayStatuses(
      dayRows.map((r) => ({
        id: r.session.id,
        plannedDate: r.session.plannedDate,
        statusOverride: r.session.statusOverride,
        completedWorkoutId: r.session.completedWorkoutId,
      })),
      workoutsByDate.get(date) ?? [],
      today,
    );
    for (const [id, st] of dayStatuses) statuses.set(id, st);
  }

  return rows.map((r) => ({
    id: r.session.id,
    planId: r.session.planId,
    plan: r.planName,
    category: r.planCategory,
    date: r.session.plannedDate,
    timeOfDay: r.session.timeOfDay,
    plannedTime: r.session.plannedTime,
    title: r.session.title,
    notes: r.session.notes,
    templateName: r.session.templateName,
    status: statuses.get(r.session.id)!,
  }));
}

export function registerPlanTools(server: McpServer, db: Db) {
  server.registerTool(
    "import_training_plan",
    {
      title: "Import training plan",
      description:
        "Creates a plan with dated sessions from a training_plan payload (see project guide format). Two-step: default returns a preview (name, category, session count, date range) — confirm with the user, then call again with confirm=true. Additive: never touches other plans or history.",
      inputSchema: {
        payloadJson: z.string().min(2),
        confirm: z.boolean().optional(),
      },
    },
    async ({ payloadJson, confirm }) => {
      let raw: unknown;
      try {
        raw = JSON.parse(payloadJson);
      } catch {
        return err("payloadJson is not valid JSON");
      }
      const parsed = trainingPlanPayloadSchema.safeParse(raw);
      if (!parsed.success) {
        return err(
          `not a valid training plan: ${parsed.error.issues
            .slice(0, 3)
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")}`,
        );
      }
      const p = parsed.data;
      const dates = p.sessions.map((s) => s.date).sort();
      const preview = {
        planName: p.planName,
        category: p.category ?? "other",
        sessions: p.sessions.length,
        firstDate: dates[0],
        lastDate: dates[dates.length - 1],
      };
      if (!confirm) {
        return ok({
          preview,
          note: "call again with confirm=true after the user approves",
        });
      }
      const [plan] = await db
        .insert(plans)
        .values({
          name: p.planName,
          category: p.category ?? "other",
          startDate: p.startDate ?? dates[0],
          endDate: p.endDate ?? dates[dates.length - 1],
        })
        .returning();
      await db.insert(plannedSessions).values(
        p.sessions.map((s) => ({
          planId: plan.id,
          plannedDate: s.date,
          timeOfDay: s.timeOfDay ?? null,
          plannedTime: s.plannedTime ?? null,
          title: s.title,
          notes: s.notes ?? null,
          templateName: s.templateName ?? null,
        })),
      );
      return ok({ planId: plan.id, imported: preview });
    },
  );

  server.registerTool(
    "list_plans",
    {
      title: "List plans",
      description:
        "All training plans with session counts. Inactive plans are hidden from the calendar but keep their history.",
      inputSchema: { includeInactive: z.boolean().optional() },
    },
    async ({ includeInactive }) => {
      const rows = await db
        .select({
          plan: plans,
          sessionCount: sql<number>`count(${plannedSessions.id})::int`,
        })
        .from(plans)
        .leftJoin(plannedSessions, eq(plannedSessions.planId, plans.id))
        .where(includeInactive ? undefined : eq(plans.active, true))
        .groupBy(plans.id)
        .orderBy(asc(plans.id));
      return ok(rows.map((r) => ({ ...r.plan, sessionCount: r.sessionCount })));
    },
  );

  server.registerTool(
    "set_plan_active",
    {
      title: "Activate/pause plan",
      description:
        "Pauses (active=false) or resumes a plan. Paused plans disappear from the calendar without losing anything.",
      inputSchema: { id: z.number().int(), active: z.boolean() },
    },
    async ({ id, active }) => {
      const [row] = await db
        .update(plans)
        .set({ active })
        .where(eq(plans.id, id))
        .returning();
      if (!row) return err(`plan ${id} not found`);
      return ok({ id: row.id, name: row.name, active: row.active });
    },
  );

  server.registerTool(
    "delete_plan",
    {
      title: "Delete plan",
      description:
        "Permanently removes a plan AND all its planned sessions (workout history is untouched). Prefer set_plan_active=false unless the user explicitly wants it gone.",
      inputSchema: { id: z.number().int() },
    },
    async ({ id }) => {
      const [plan] = await db.select().from(plans).where(eq(plans.id, id));
      if (!plan) return err(`plan ${id} not found`);
      await db.delete(plannedSessions).where(eq(plannedSessions.planId, id));
      await db.delete(plans).where(eq(plans.id, id));
      return ok({ id, name: plan.name, deleted: true });
    },
  );

  server.registerTool(
    "add_planned_session",
    {
      title: "Add planned session",
      description: "Adds one dated session to an existing plan.",
      inputSchema: {
        planId: z.number().int(),
        ...plannedSessionInputSchema.shape,
      },
    },
    async ({ planId, ...rest }) => {
      const input = plannedSessionInputSchema.parse(rest);
      const [plan] = await db.select().from(plans).where(eq(plans.id, planId));
      if (!plan) return err(`plan ${planId} not found`);
      const [row] = await db
        .insert(plannedSessions)
        .values({
          planId,
          plannedDate: input.date,
          timeOfDay: input.timeOfDay ?? null,
          plannedTime: input.plannedTime ?? null,
          title: input.title,
          notes: input.notes ?? null,
          templateName: input.templateName ?? null,
        })
        .returning();
      return ok(row);
    },
  );

  server.registerTool(
    "update_planned_session",
    {
      title: "Update planned session",
      description:
        "Updates a session: move its date/time, edit title/notes, set statusOverride ('skipped' | 'moved' | 'completed', or null to clear), or link a workout via completedWorkoutId. Moving a session to a new date = update date + set the old expectation via a new 'moved' session, or simply change the date if the user just rescheduled.",
      inputSchema: {
        id: z.number().int(),
        date: dateStr.optional(),
        timeOfDay: timeOfDaySchema.nullable().optional(),
        plannedTime: timeStr.nullable().optional(),
        title: z.string().min(1).optional(),
        notes: z.string().nullable().optional(),
        templateName: z.string().nullable().optional(),
        statusOverride: sessionStatusOverrideSchema.nullable().optional(),
        completedWorkoutId: z.number().int().nullable().optional(),
      },
    },
    async ({ id, date, ...rest }) => {
      const set: Record<string, unknown> = {};
      if (date !== undefined) set.plannedDate = date;
      for (const [k, v] of Object.entries(rest)) {
        if (v !== undefined) set[k] = v;
      }
      if (Object.keys(set).length === 0) return err("no fields to update");
      const [row] = await db
        .update(plannedSessions)
        .set(set)
        .where(eq(plannedSessions.id, id))
        .returning();
      if (!row) return err(`planned session ${id} not found`);
      return ok(row);
    },
  );

  server.registerTool(
    "delete_planned_session",
    {
      title: "Delete planned session",
      description: "Removes one planned session.",
      inputSchema: { id: z.number().int() },
    },
    async ({ id }) => {
      const [row] = await db
        .delete(plannedSessions)
        .where(eq(plannedSessions.id, id))
        .returning();
      if (!row) return err(`planned session ${id} not found`);
      return ok({ id, deleted: true });
    },
  );

  server.registerTool(
    "get_calendar",
    {
      title: "Get calendar",
      description:
        "The central training calendar: all active plans' sessions in a date range (default: today through +7 days), grouped by day, each with computed status (completed / missed / today / upcoming / skipped / moved).",
      inputSchema: {
        fromDate: dateStr.optional(),
        toDate: dateStr.optional(),
      },
    },
    async ({ fromDate, toDate }) => {
      const today = await getToday(db);
      const from = fromDate ?? today;
      const to =
        toDate ??
        new Date(new Date(from).getTime() + 7 * 86400000)
          .toISOString()
          .slice(0, 10);
      const sessions = await sessionsWithStatuses(db, from, to);
      const days: Record<string, typeof sessions> = {};
      for (const s of sessions) days[s.date] = [...(days[s.date] ?? []), s];
      return ok({ today, fromDate: from, toDate: to, days });
    },
  );

  server.registerTool(
    "get_plan_adherence",
    {
      title: "Get plan adherence",
      description:
        "Scoreboard for one plan (planId) or all active plans: completed/missed/skipped counts and completion rate over a date range (default: each plan's full past-to-date span).",
      inputSchema: {
        planId: z.number().int().optional(),
        fromDate: dateStr.optional(),
        toDate: dateStr.optional(),
      },
    },
    async ({ planId, fromDate, toDate }) => {
      const today = await getToday(db);
      const sessions = await sessionsWithStatuses(
        db,
        fromDate ?? "1970-01-01",
        toDate ?? today,
        planId,
      );
      const byPlan = new Map<string, typeof sessions>();
      for (const s of sessions) {
        byPlan.set(s.plan, [...(byPlan.get(s.plan) ?? []), s]);
      }
      const summarize = (list: typeof sessions) => {
        const due = list.filter((s) =>
          ["completed", "missed", "skipped", "today"].includes(s.status),
        );
        const completed = due.filter((s) => s.status === "completed").length;
        const missed = due.filter((s) => s.status === "missed").length;
        const skipped = due.filter((s) => s.status === "skipped").length;
        const denominator = completed + missed; // skipped/moved don't count against you
        return {
          completed,
          missed,
          skipped,
          dueSoFar: due.length,
          completionRate:
            denominator > 0 ? Math.round((completed / denominator) * 100) : null,
          missedSessions: list
            .filter((s) => s.status === "missed")
            .map((s) => ({ date: s.date, title: s.title })),
        };
      };
      return ok({
        asOf: today,
        overall: summarize(sessions),
        perPlan: Object.fromEntries(
          [...byPlan].map(([name, list]) => [name, summarize(list)]),
        ),
      });
    },
  );
}
