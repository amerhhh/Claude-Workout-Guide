import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { and, desc, eq, gte, isNotNull, lt, lte, ne } from "drizzle-orm";
import {
  attachWorkoutMetricsSchema,
  logDailyMetricsSchema,
} from "@workoutguide/shared";
import type { Db } from "../db/index.js";
import {
  dailyMetrics,
  workoutHistory,
  plannedSessions,
  plans,
} from "../db/schema.js";
import { ok, err, numOrNull } from "../lib/respond.js";
import { mergeDailyMetrics, priorityOf, type MetricRow } from "../lib/merge.js";
import { computeStreak } from "../lib/streak.js";

const todayKey = () => new Date().toISOString().slice(0, 10);
const dateKey = (d: Date) => d.toISOString().slice(0, 10);

function rowToMetricRow(row: typeof dailyMetrics.$inferSelect): MetricRow {
  return {
    source: row.source,
    rawJson: row.rawJson,
    recoveryScore: row.recoveryScore,
    hrvMs: row.hrvMs,
    restingHr: row.restingHr,
    sleepPerformance: row.sleepPerformance,
    sleepDurationMinutes: row.sleepDurationMinutes,
    dayStrain: numOrNull(row.dayStrain),
  };
}

function presentRow(row: typeof dailyMetrics.$inferSelect) {
  return { ...row, dayStrain: numOrNull(row.dayStrain) };
}

export function registerMetricsTools(server: McpServer, db: Db) {
  server.registerTool(
    "log_daily_metrics",
    {
      title: "Log daily metrics",
      description:
        "Upserts one day's health metrics with per-field merge: a value lands when the slot is empty or the incoming source ranks at least as high as the row's source (apple_health > whoop/garmin > manual). Fields you omit are never erased, so sources coexist. Pass the source's full payload in rawJson when available.",
      inputSchema: logDailyMetricsSchema.shape,
    },
    async (input) => {
      const parsed = logDailyMetricsSchema.parse(input);
      const source = parsed.source ?? "manual";
      const [existing] = await db
        .select()
        .from(dailyMetrics)
        .where(eq(dailyMetrics.metricDate, parsed.date));

      const merged = mergeDailyMetrics(
        existing ? rowToMetricRow(existing) : null,
        {
          source,
          rawJson: parsed.rawJson,
          recoveryScore: parsed.recoveryScore,
          hrvMs: parsed.hrvMs,
          restingHr: parsed.restingHr,
          sleepPerformance: parsed.sleepPerformance,
          sleepDurationMinutes: parsed.sleepDurationMinutes,
          dayStrain: parsed.dayStrain,
        },
      );

      const values = {
        recoveryScore: merged.fields.recoveryScore ?? null,
        hrvMs: merged.fields.hrvMs ?? null,
        restingHr: merged.fields.restingHr ?? null,
        sleepPerformance: merged.fields.sleepPerformance ?? null,
        sleepDurationMinutes: merged.fields.sleepDurationMinutes ?? null,
        dayStrain:
          merged.fields.dayStrain != null ? String(merged.fields.dayStrain) : null,
        source: merged.source,
        rawJson: merged.rawJson,
        recordedAt: new Date(),
      };

      const [row] = existing
        ? await db
            .update(dailyMetrics)
            .set(values)
            .where(eq(dailyMetrics.id, existing.id))
            .returning()
        : await db
            .insert(dailyMetrics)
            .values({ metricDate: parsed.date, ...values })
            .returning();

      return ok({
        ...presentRow(row),
        mergeNote: merged.wroteAnyField
          ? undefined
          : `no fields changed — existing values from '${row.source}' outrank '${source}' and no empty slots matched`,
      });
    },
  );

  server.registerTool(
    "get_daily_metrics",
    {
      title: "Get daily metrics",
      description:
        "One day's metrics (default: today, server time) or a range via fromDate/toDate — for readiness checks and trend callouts.",
      inputSchema: {
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      },
    },
    async ({ date, fromDate, toDate }) => {
      if (date && (fromDate || toDate)) {
        return err("use either date or fromDate/toDate, not both");
      }
      if (fromDate || toDate) {
        const rows = await db
          .select()
          .from(dailyMetrics)
          .where(
            and(
              fromDate ? gte(dailyMetrics.metricDate, fromDate) : undefined,
              toDate ? lte(dailyMetrics.metricDate, toDate) : undefined,
            ),
          )
          .orderBy(desc(dailyMetrics.metricDate));
        return ok(rows.map(presentRow));
      }
      const target = date ?? todayKey();
      const [row] = await db
        .select()
        .from(dailyMetrics)
        .where(eq(dailyMetrics.metricDate, target));
      return ok(row ? presentRow(row) : { date: target, note: "no metrics logged for this day" });
    },
  );

  server.registerTool(
    "attach_workout_metrics",
    {
      title: "Attach workout metrics",
      description:
        "Enriches a completed session with wearable data (HR, strain, calories). Idempotent via externalActivityId: if that activity is already attached to a workout, nothing is duplicated. Per-field source priority matches log_daily_metrics.",
      inputSchema: attachWorkoutMetricsSchema.shape,
    },
    async (input) => {
      const parsed = attachWorkoutMetricsSchema.parse(input);
      const source = parsed.source ?? "manual";
      const [workout] = await db
        .select()
        .from(workoutHistory)
        .where(eq(workoutHistory.id, parsed.workoutHistoryId));
      if (!workout) return err(`workout ${parsed.workoutHistoryId} not found`);

      if (parsed.externalActivityId) {
        const [dup] = await db
          .select()
          .from(workoutHistory)
          .where(
            and(
              eq(workoutHistory.externalActivityId, parsed.externalActivityId),
              ne(workoutHistory.id, parsed.workoutHistoryId),
            ),
          );
        if (dup) {
          return ok({
            deduped: true,
            note: `externalActivityId ${parsed.externalActivityId} is already attached to workout ${dup.id}; nothing written`,
            attachedWorkoutId: dup.id,
          });
        }
      }

      const existingPriority = priorityOf(workout.metricsSource ?? "");
      const incomingWins = priorityOf(source) >= existingPriority || workout.metricsSource == null;

      const set: Partial<typeof workoutHistory.$inferInsert> = {};
      let wrote = false;
      const fields = [
        ["avgHeartrate", parsed.avgHeartrate],
        ["maxHeartrate", parsed.maxHeartrate],
        ["calories", parsed.calories],
      ] as const;
      for (const [key, value] of fields) {
        if (value != null && (workout[key] == null || incomingWins)) {
          set[key] = value;
          wrote = true;
        }
      }
      if (
        parsed.workoutStrain != null &&
        (workout.workoutStrain == null || incomingWins)
      ) {
        set.workoutStrain = String(parsed.workoutStrain);
        wrote = true;
      }
      if (parsed.externalActivityId != null && workout.externalActivityId == null) {
        set.externalActivityId = parsed.externalActivityId;
        wrote = true;
      }
      if (wrote) set.metricsSource = source;

      if (!wrote) {
        return ok({
          workoutHistoryId: workout.id,
          note: `nothing written — existing metrics from '${workout.metricsSource}' outrank '${source}'`,
        });
      }
      const [updated] = await db
        .update(workoutHistory)
        .set(set)
        .where(eq(workoutHistory.id, workout.id))
        .returning();
      return ok({
        workoutHistoryId: updated.id,
        avgHeartrate: updated.avgHeartrate,
        maxHeartrate: updated.maxHeartrate,
        workoutStrain: numOrNull(updated.workoutStrain),
        calories: updated.calories,
        externalActivityId: updated.externalActivityId,
        metricsSource: updated.metricsSource,
      });
    },
  );

  server.registerTool(
    "get_readiness_context",
    {
      title: "Get readiness context",
      description:
        "One call for session openers: today's metrics, 7-day baselines (HRV, resting HR, recovery, sleep), the last completed workout's exertion, and the current streak.",
      inputSchema: {},
    },
    async () => {
      const today = todayKey();
      const weekAgo = dateKey(new Date(Date.now() - 7 * 24 * 3600 * 1000));

      const [todayRow] = await db
        .select()
        .from(dailyMetrics)
        .where(eq(dailyMetrics.metricDate, today));

      // baseline = the 7 days before today, so today's reading is judged against it
      const baselineRows = await db
        .select()
        .from(dailyMetrics)
        .where(
          and(
            gte(dailyMetrics.metricDate, weekAgo),
            lt(dailyMetrics.metricDate, today),
          ),
        );
      const avg = (vals: (number | null)[]) => {
        const xs = vals.filter((v): v is number => v != null);
        return xs.length
          ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10
          : null;
      };

      const [lastWorkout] = await db
        .select()
        .from(workoutHistory)
        .where(isNotNull(workoutHistory.completedAt))
        .orderBy(desc(workoutHistory.completedAt))
        .limit(1);

      const completed = await db
        .select({ completedAt: workoutHistory.completedAt })
        .from(workoutHistory)
        .where(isNotNull(workoutHistory.completedAt));

      const todaysPlan = await db
        .select({ session: plannedSessions, planName: plans.name, category: plans.category })
        .from(plannedSessions)
        .innerJoin(plans, eq(plannedSessions.planId, plans.id))
        .where(
          and(eq(plannedSessions.plannedDate, today), eq(plans.active, true)),
        );

      return ok({
        serverDate: today,
        today: todayRow ? presentRow(todayRow) : null,
        baseline7d: {
          daysWithData: baselineRows.length,
          avgHrvMs: avg(baselineRows.map((r) => r.hrvMs)),
          avgRestingHr: avg(baselineRows.map((r) => r.restingHr)),
          avgRecoveryScore: avg(baselineRows.map((r) => r.recoveryScore)),
          avgSleepDurationMinutes: avg(
            baselineRows.map((r) => r.sleepDurationMinutes),
          ),
        },
        lastWorkout: lastWorkout
          ? {
              workoutHistoryId: lastWorkout.id,
              completedAt: lastWorkout.completedAt,
              exercisesCompleted: lastWorkout.exercisesCompleted,
              totalDurationSeconds: lastWorkout.totalDurationSeconds,
              workoutStrain: numOrNull(lastWorkout.workoutStrain),
              avgHeartrate: lastWorkout.avgHeartrate,
              notes: lastWorkout.notes,
            }
          : null,
        streakDays: computeStreak(
          completed.map((r) => r.completedAt!) as Date[],
        ),
        todaysPlannedSessions: todaysPlan.map((t) => ({
          id: t.session.id,
          plan: t.planName,
          category: t.category,
          title: t.session.title,
          timeOfDay: t.session.timeOfDay,
          plannedTime: t.session.plannedTime,
          notes: t.session.notes,
          done: t.session.completedWorkoutId != null,
        })),
      });
    },
  );
}
