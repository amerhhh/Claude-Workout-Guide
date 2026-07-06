import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { desc, eq, inArray, isNotNull, and } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { exercises, exerciseLogs, workoutHistory } from "../db/schema.js";
import { ok, err, numOrNull } from "../lib/respond.js";
import { computeStreak } from "../lib/streak.js";

export function registerHistoryTools(server: McpServer, db: Db) {
  server.registerTool(
    "get_streak",
    {
      title: "Get streak",
      description:
        "Current consecutive-day streak of completed workouts (a streak ending yesterday still counts — today isn't over).",
      inputSchema: {},
    },
    async () => {
      const rows = await db
        .select({ completedAt: workoutHistory.completedAt })
        .from(workoutHistory)
        .where(isNotNull(workoutHistory.completedAt));
      const dates = rows.map((r) => r.completedAt!) as Date[];
      const last = dates.length
        ? new Date(Math.max(...dates.map((d) => d.getTime())))
        : null;
      return ok({
        streakDays: computeStreak(dates),
        totalCompletedWorkouts: dates.length,
        lastCompletedAt: last,
      });
    },
  );

  server.registerTool(
    "get_progress_summary",
    {
      title: "Get progress summary",
      description:
        "Last 7 finished attempts of one exercise (reps/duration/rest), newest first — the data for progressive-overload suggestions.",
      inputSchema: { exerciseId: z.number().int() },
    },
    async ({ exerciseId }) => {
      const [exercise] = await db
        .select()
        .from(exercises)
        .where(eq(exercises.id, exerciseId));
      if (!exercise) return err(`exercise ${exerciseId} not found`);
      const logs = await db
        .select()
        .from(exerciseLogs)
        .where(
          and(
            eq(exerciseLogs.exerciseId, exerciseId),
            isNotNull(exerciseLogs.actualDurationSeconds),
          ),
        )
        .orderBy(desc(exerciseLogs.id))
        .limit(7);
      return ok({
        exercise: {
          id: exercise.id,
          name: exercise.name,
          plannedDurationSeconds: exercise.durationSeconds,
          plannedRestSeconds: exercise.restAfterSeconds,
        },
        sessions: logs.map((l) => ({
          recordedAt: l.recordedAt,
          repsText: l.repsText,
          actualDurationSeconds: l.actualDurationSeconds,
          plannedDurationSeconds: l.plannedDurationSeconds,
          endedEarly: l.endedEarly,
          actualRestSeconds: l.actualRestSeconds,
          restExtended: l.restExtended,
          feedbackText: l.feedbackText,
        })),
      });
    },
  );

  server.registerTool(
    "get_history",
    {
      title: "Get history",
      description: "Recent workout sessions with nested per-exercise logs, newest first.",
      inputSchema: { limit: z.number().int().min(1).max(100).optional() },
    },
    async ({ limit }) => {
      const workouts = await db
        .select()
        .from(workoutHistory)
        .orderBy(desc(workoutHistory.startedAt))
        .limit(limit ?? 10);
      if (workouts.length === 0) return ok([]);

      const logs = await db
        .select({
          log: exerciseLogs,
          exerciseName: exercises.name,
        })
        .from(exerciseLogs)
        .innerJoin(exercises, eq(exerciseLogs.exerciseId, exercises.id))
        .where(
          inArray(
            exerciseLogs.workoutHistoryId,
            workouts.map((w) => w.id),
          ),
        );

      return ok(
        workouts.map((w) => ({
          ...w,
          workoutStrain: numOrNull(w.workoutStrain),
          logs: logs
            .filter((l) => l.log.workoutHistoryId === w.id)
            .map(({ log, exerciseName }) => ({
              exerciseId: log.exerciseId,
              exerciseName,
              repsText: log.repsText,
              feedbackText: log.feedbackText,
              actualDurationSeconds: log.actualDurationSeconds,
              plannedDurationSeconds: log.plannedDurationSeconds,
              endedEarly: log.endedEarly,
              actualRestSeconds: log.actualRestSeconds,
              restExtended: log.restExtended,
            })),
        })),
      );
    },
  );
}
