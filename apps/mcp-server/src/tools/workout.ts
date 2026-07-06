import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { and, desc, eq, isNull, isNotNull } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { exercises, exerciseLogs, workoutHistory } from "../db/schema.js";
import { ok, err } from "../lib/respond.js";

async function getExercise(db: Db, exerciseId: number) {
  const [row] = await db
    .select()
    .from(exercises)
    .where(eq(exercises.id, exerciseId));
  return row;
}

/** The log row all in-flight tools operate on: the newest one for this exercise. */
async function getCurrentLog(db: Db, exerciseId: number) {
  const [row] = await db
    .select()
    .from(exerciseLogs)
    .where(eq(exerciseLogs.exerciseId, exerciseId))
    .orderBy(desc(exerciseLogs.id))
    .limit(1);
  return row;
}

async function getActiveWorkout(db: Db) {
  const [row] = await db
    .select()
    .from(workoutHistory)
    .where(isNull(workoutHistory.completedAt))
    .orderBy(desc(workoutHistory.startedAt))
    .limit(1);
  return row;
}

const secondsBetween = (from: Date, to: Date) =>
  Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000));

export function registerWorkoutTools(server: McpServer, db: Db) {
  server.registerTool(
    "get_todays_exercises",
    {
      title: "Get today's exercises",
      description:
        "Ordered list of currently configured (non-retired) exercises for the session.",
      inputSchema: {},
    },
    async () => {
      const rows = await db
        .select()
        .from(exercises)
        .where(isNull(exercises.retiredAt))
        .orderBy(exercises.sortOrder, exercises.id);
      return ok(
        rows.map(({ imageData, ...rest }) => ({
          ...rest,
          hasImage: imageData != null,
        })),
      );
    },
  );

  server.registerTool(
    "start_workout",
    {
      title: "Start workout",
      description:
        "Creates a workout_history session row and returns its id. If an unfinished session already exists, returns it instead of opening a duplicate.",
      inputSchema: {},
    },
    async () => {
      const existing = await getActiveWorkout(db);
      if (existing) {
        return ok({
          workoutHistoryId: existing.id,
          startedAt: existing.startedAt,
          note: "resumed an already-active session (not completed yet); call complete_workout to close it",
        });
      }
      const [row] = await db
        .insert(workoutHistory)
        .values({ startedAt: new Date() })
        .returning();
      return ok({ workoutHistoryId: row.id, startedAt: row.startedAt });
    },
  );

  server.registerTool(
    "start_exercise",
    {
      title: "Start exercise",
      description:
        "Records the start of an exercise attempt. Returns planned duration plus the last session's log for this exercise (for \"last time...\" callouts).",
      inputSchema: { exerciseId: z.number().int() },
    },
    async ({ exerciseId }) => {
      const exercise = await getExercise(db, exerciseId);
      if (!exercise) return err(`exercise ${exerciseId} not found`);

      const [lastSession] = await db
        .select()
        .from(exerciseLogs)
        .where(
          and(
            eq(exerciseLogs.exerciseId, exerciseId),
            isNotNull(exerciseLogs.actualDurationSeconds),
          ),
        )
        .orderBy(desc(exerciseLogs.id))
        .limit(1);

      const active = await getActiveWorkout(db);
      const [log] = await db
        .insert(exerciseLogs)
        .values({
          exerciseId,
          workoutHistoryId: active?.id ?? null,
          startedAt: new Date(),
          plannedDurationSeconds: exercise.durationSeconds,
          plannedRestSeconds: exercise.restAfterSeconds,
        })
        .returning();

      return ok({
        logId: log.id,
        exercise: {
          id: exercise.id,
          name: exercise.name,
          plannedDurationSeconds: exercise.durationSeconds,
          plannedRestSeconds: exercise.restAfterSeconds,
          voiceStart: exercise.voiceStart,
        },
        workoutHistoryId: active?.id ?? null,
        lastSession: lastSession
          ? {
              recordedAt: lastSession.recordedAt,
              repsText: lastSession.repsText,
              actualDurationSeconds: lastSession.actualDurationSeconds,
              plannedDurationSeconds: lastSession.plannedDurationSeconds,
              endedEarly: lastSession.endedEarly,
              actualRestSeconds: lastSession.actualRestSeconds,
              restExtended: lastSession.restExtended,
              feedbackText: lastSession.feedbackText,
            }
          : null,
      });
    },
  );

  server.registerTool(
    "end_exercise",
    {
      title: "End exercise",
      description:
        "Records how long the exercise actually ran and whether it stopped early. actualDurationSeconds defaults to server-clock elapsed since start_exercise.",
      inputSchema: {
        exerciseId: z.number().int(),
        endedEarly: z.boolean().optional(),
        actualDurationSeconds: z.number().int().nonnegative().optional(),
      },
    },
    async ({ exerciseId, endedEarly, actualDurationSeconds }) => {
      const log = await getCurrentLog(db, exerciseId);
      if (!log?.startedAt) {
        return err(`no started exercise attempt found for exercise ${exerciseId}; call start_exercise first`);
      }
      const now = new Date();
      const actual =
        actualDurationSeconds ?? secondsBetween(log.startedAt, now);
      const early =
        endedEarly ??
        (log.plannedDurationSeconds != null &&
          actual < log.plannedDurationSeconds - 2);
      const exercise = await getExercise(db, exerciseId);
      const [updated] = await db
        .update(exerciseLogs)
        .set({ actualDurationSeconds: actual, endedEarly: early })
        .where(eq(exerciseLogs.id, log.id))
        .returning();
      return ok({
        logId: updated.id,
        actualDurationSeconds: updated.actualDurationSeconds,
        plannedDurationSeconds: updated.plannedDurationSeconds,
        endedEarly: updated.endedEarly,
        voiceEnd: exercise?.voiceEnd ?? null,
      });
    },
  );

  server.registerTool(
    "log_feedback",
    {
      title: "Log feedback",
      description:
        "Saves reported reps and/or freeform comments (\"felt easy\", \"shoulder tight\") on the current attempt of this exercise.",
      inputSchema: {
        exerciseId: z.number().int(),
        repsText: z.string().optional(),
        feedbackText: z.string().optional(),
      },
    },
    async ({ exerciseId, repsText, feedbackText }) => {
      if (repsText == null && feedbackText == null) {
        return err("provide repsText and/or feedbackText");
      }
      const log = await getCurrentLog(db, exerciseId);
      if (!log) return err(`no exercise attempt found for exercise ${exerciseId}`);
      const set: Partial<typeof exerciseLogs.$inferInsert> = {};
      if (repsText != null) set.repsText = repsText;
      if (feedbackText != null) {
        set.feedbackText = log.feedbackText
          ? `${log.feedbackText} | ${feedbackText}`
          : feedbackText;
      }
      const [updated] = await db
        .update(exerciseLogs)
        .set(set)
        .where(eq(exerciseLogs.id, log.id))
        .returning();
      return ok({
        logId: updated.id,
        repsText: updated.repsText,
        feedbackText: updated.feedbackText,
      });
    },
  );

  server.registerTool(
    "start_rest",
    {
      title: "Start rest",
      description:
        "Marks the start of the rest period after an exercise. plannedRestSeconds defaults to the value snapshotted at start_exercise.",
      inputSchema: {
        exerciseId: z.number().int(),
        plannedRestSeconds: z.number().int().nonnegative().optional(),
      },
    },
    async ({ exerciseId, plannedRestSeconds }) => {
      const log = await getCurrentLog(db, exerciseId);
      if (!log) return err(`no exercise attempt found for exercise ${exerciseId}; call start_exercise first`);
      const [updated] = await db
        .update(exerciseLogs)
        .set({
          restStartedAt: new Date(),
          ...(plannedRestSeconds != null ? { plannedRestSeconds } : {}),
        })
        .where(eq(exerciseLogs.id, log.id))
        .returning();
      return ok({
        logId: updated.id,
        restStartedAt: updated.restStartedAt,
        plannedRestSeconds: updated.plannedRestSeconds,
      });
    },
  );

  server.registerTool(
    "check_time",
    {
      title: "Check time",
      description:
        "Authoritative timing from the server clock for the current attempt of an exercise: elapsed/remaining vs planned duration while working, or vs planned rest while resting. Claude has no internal clock — use this whenever precise elapsed/remaining time matters.",
      inputSchema: { exerciseId: z.number().int() },
    },
    async ({ exerciseId }) => {
      const log = await getCurrentLog(db, exerciseId);
      if (!log) return err(`no exercise attempt found for exercise ${exerciseId}`);
      const now = new Date();

      const resting = log.restStartedAt != null && log.actualRestSeconds == null;
      const working =
        !resting && log.startedAt != null && log.actualDurationSeconds == null;

      if (!resting && !working) {
        return ok({
          serverTime: now.toISOString(),
          phase: "idle",
          note: "this exercise attempt is already finalized",
        });
      }

      const ref = resting ? log.restStartedAt! : log.startedAt!;
      const planned = resting
        ? log.plannedRestSeconds
        : log.plannedDurationSeconds;
      const elapsed = secondsBetween(ref, now);
      return ok({
        serverTime: now.toISOString(),
        phase: resting ? "resting" : "working",
        elapsedSeconds: elapsed,
        plannedSeconds: planned,
        remainingSeconds: planned != null ? planned - elapsed : null,
      });
    },
  );

  server.registerTool(
    "end_rest",
    {
      title: "End rest",
      description:
        "Records actual rest taken and finalizes the exercise_logs row. actualRestSeconds defaults to server-clock elapsed since start_rest; restExtended defaults to actual exceeding planned by >5s.",
      inputSchema: {
        exerciseId: z.number().int(),
        actualRestSeconds: z.number().int().nonnegative().optional(),
        restExtended: z.boolean().optional(),
      },
    },
    async ({ exerciseId, actualRestSeconds, restExtended }) => {
      const log = await getCurrentLog(db, exerciseId);
      if (!log) return err(`no exercise attempt found for exercise ${exerciseId}`);
      const now = new Date();
      const actual =
        actualRestSeconds ??
        (log.restStartedAt ? secondsBetween(log.restStartedAt, now) : 0);
      const extended =
        restExtended ??
        (log.plannedRestSeconds != null && actual > log.plannedRestSeconds + 5);
      const [updated] = await db
        .update(exerciseLogs)
        .set({ actualRestSeconds: actual, restExtended: extended })
        .where(eq(exerciseLogs.id, log.id))
        .returning();
      return ok({
        logId: updated.id,
        actualRestSeconds: updated.actualRestSeconds,
        plannedRestSeconds: updated.plannedRestSeconds,
        restExtended: updated.restExtended,
      });
    },
  );

  server.registerTool(
    "complete_workout",
    {
      title: "Complete workout",
      description:
        "Marks the session complete. exercisesCompleted defaults to the number of distinct exercises logged in the session; total duration is computed from the server clock.",
      inputSchema: {
        workoutHistoryId: z.number().int(),
        exercisesCompleted: z.number().int().nonnegative().optional(),
      },
    },
    async ({ workoutHistoryId, exercisesCompleted }) => {
      const [workout] = await db
        .select()
        .from(workoutHistory)
        .where(eq(workoutHistory.id, workoutHistoryId));
      if (!workout) return err(`workout ${workoutHistoryId} not found`);
      if (workout.completedAt) {
        return ok({
          workoutHistoryId,
          completedAt: workout.completedAt,
          note: "already completed",
        });
      }
      const logs = await db
        .select()
        .from(exerciseLogs)
        .where(eq(exerciseLogs.workoutHistoryId, workoutHistoryId));
      const distinctExercises = [...new Set(logs.map((l) => l.exerciseId))];
      const now = new Date();
      const [updated] = await db
        .update(workoutHistory)
        .set({
          completedAt: now,
          exercisesCompleted: exercisesCompleted ?? distinctExercises.length,
          exercisesJson: JSON.stringify(distinctExercises),
          totalDurationSeconds: secondsBetween(workout.startedAt, now),
        })
        .where(eq(workoutHistory.id, workoutHistoryId))
        .returning();
      return ok({
        workoutHistoryId: updated.id,
        completedAt: updated.completedAt,
        exercisesCompleted: updated.exercisesCompleted,
        totalDurationSeconds: updated.totalDurationSeconds,
        loggedAttempts: logs.length,
      });
    },
  );

  server.registerTool(
    "save_workout_note",
    {
      title: "Save workout note",
      description: "Attaches a freeform note to a workout session (appends if one exists).",
      inputSchema: {
        workoutHistoryId: z.number().int(),
        notes: z.string().min(1),
      },
    },
    async ({ workoutHistoryId, notes }) => {
      const [workout] = await db
        .select()
        .from(workoutHistory)
        .where(eq(workoutHistory.id, workoutHistoryId));
      if (!workout) return err(`workout ${workoutHistoryId} not found`);
      const [updated] = await db
        .update(workoutHistory)
        .set({ notes: workout.notes ? `${workout.notes}\n${notes}` : notes })
        .where(eq(workoutHistory.id, workoutHistoryId))
        .returning();
      return ok({ workoutHistoryId: updated.id, notes: updated.notes });
    },
  );
}
