import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { asc, eq, isNull } from "drizzle-orm";
import {
  backupPayloadSchema,
  shareablePayloadSchema,
  type BackupPayload,
  type ShareablePayload,
} from "@workoutguide/shared";
import type { Db } from "../db/index.js";
import {
  appSettings,
  dailyMetrics,
  exercises,
  exerciseLogs,
  workoutHistory,
  workoutTemplates,
} from "../db/schema.js";
import { ok, err, numOrNull } from "../lib/respond.js";

const iso = (d: Date | null) => (d ? d.toISOString() : null);

async function buildBackup(db: Db): Promise<BackupPayload> {
  const [allExercises, templates, workouts, logs, metrics, settings] =
    await Promise.all([
      db.select().from(exercises).orderBy(asc(exercises.sortOrder), asc(exercises.id)),
      db.select().from(workoutTemplates),
      db.select().from(workoutHistory).orderBy(asc(workoutHistory.startedAt)),
      db.select().from(exerciseLogs).orderBy(asc(exerciseLogs.id)),
      db.select().from(dailyMetrics).orderBy(asc(dailyMetrics.metricDate)),
      db.select().from(appSettings),
    ]);
  const nameById = new Map(allExercises.map((e) => [e.id, e.name]));

  const presentLog = (l: typeof exerciseLogs.$inferSelect) => ({
    exerciseName: nameById.get(l.exerciseId) ?? `exercise-${l.exerciseId}`,
    repsText: l.repsText,
    feedbackText: l.feedbackText,
    startedAt: iso(l.startedAt),
    plannedDurationSeconds: l.plannedDurationSeconds,
    actualDurationSeconds: l.actualDurationSeconds,
    endedEarly: l.endedEarly,
    plannedRestSeconds: l.plannedRestSeconds,
    actualRestSeconds: l.actualRestSeconds,
    restExtended: l.restExtended,
    recordedAt: l.recordedAt.toISOString(),
  });

  return {
    version: 1,
    kind: "backup",
    exportedAt: new Date().toISOString(),
    exercises: allExercises.map((e) => ({
      name: e.name,
      durationSeconds: e.durationSeconds,
      restAfterSeconds: e.restAfterSeconds,
      sortOrder: e.sortOrder,
      voiceStart: e.voiceStart,
      voiceEnd: e.voiceEnd,
      imageData: e.imageData,
      retiredAt: iso(e.retiredAt),
    })),
    templates: templates.map((t) => ({
      name: t.name,
      exercisesJson: t.exercisesJson,
      isActive: t.isActive,
    })),
    history: workouts.map((w) => ({
      startedAt: w.startedAt.toISOString(),
      completedAt: iso(w.completedAt),
      exercisesCompleted: w.exercisesCompleted,
      exercisesJson: w.exercisesJson,
      totalDurationSeconds: w.totalDurationSeconds,
      notes: w.notes,
      avgHeartrate: w.avgHeartrate,
      maxHeartrate: w.maxHeartrate,
      workoutStrain: numOrNull(w.workoutStrain),
      calories: w.calories,
      externalActivityId: w.externalActivityId,
      metricsSource: w.metricsSource,
      logs: logs.filter((l) => l.workoutHistoryId === w.id).map(presentLog),
    })),
    looseLogs: logs.filter((l) => l.workoutHistoryId == null).map(presentLog),
    dailyMetrics: metrics.map((m) => ({
      metricDate: m.metricDate,
      recoveryScore: m.recoveryScore,
      hrvMs: m.hrvMs,
      restingHr: m.restingHr,
      sleepPerformance: m.sleepPerformance,
      sleepDurationMinutes: m.sleepDurationMinutes,
      dayStrain: numOrNull(m.dayStrain),
      source: m.source,
      rawJson: m.rawJson,
    })),
    settings: settings.map((s) => ({ key: s.key, value: s.value })),
  };
}

async function restoreBackup(db: Db, payload: BackupPayload) {
  await db.transaction(async (tx) => {
    // wipe in FK-safe order
    await tx.delete(exerciseLogs);
    await tx.delete(workoutHistory);
    await tx.delete(exercises);
    await tx.delete(workoutTemplates);
    await tx.delete(dailyMetrics);
    await tx.delete(appSettings);

    const idByName = new Map<string, number>();
    for (const e of payload.exercises) {
      const [row] = await tx
        .insert(exercises)
        .values({
          name: e.name,
          durationSeconds: e.durationSeconds,
          restAfterSeconds: e.restAfterSeconds,
          sortOrder: e.sortOrder,
          voiceStart: e.voiceStart,
          voiceEnd: e.voiceEnd,
          imageData: e.imageData,
          retiredAt: e.retiredAt ? new Date(e.retiredAt) : null,
        })
        .returning();
      idByName.set(row.name, row.id);
    }

    if (payload.templates.length) {
      await tx.insert(workoutTemplates).values(payload.templates);
    }

    const insertLog = async (
      tx2: typeof tx,
      l: BackupPayload["history"][number]["logs"][number],
      workoutHistoryId: number | null,
    ) => {
      let exerciseId = idByName.get(l.exerciseName);
      if (exerciseId == null) {
        // log references an exercise missing from the payload — recreate it retired
        const [orphan] = await tx2
          .insert(exercises)
          .values({ name: l.exerciseName, retiredAt: new Date() })
          .returning();
        exerciseId = orphan.id;
        idByName.set(l.exerciseName, exerciseId);
      }
      await tx2.insert(exerciseLogs).values({
        exerciseId,
        workoutHistoryId,
        repsText: l.repsText,
        feedbackText: l.feedbackText,
        startedAt: l.startedAt ? new Date(l.startedAt) : null,
        plannedDurationSeconds: l.plannedDurationSeconds,
        actualDurationSeconds: l.actualDurationSeconds,
        endedEarly: l.endedEarly,
        plannedRestSeconds: l.plannedRestSeconds,
        actualRestSeconds: l.actualRestSeconds,
        restExtended: l.restExtended,
        recordedAt: new Date(l.recordedAt),
      });
    };

    for (const w of payload.history) {
      const [workout] = await tx
        .insert(workoutHistory)
        .values({
          startedAt: new Date(w.startedAt),
          completedAt: w.completedAt ? new Date(w.completedAt) : null,
          exercisesCompleted: w.exercisesCompleted,
          exercisesJson: w.exercisesJson,
          totalDurationSeconds: w.totalDurationSeconds,
          notes: w.notes,
          avgHeartrate: w.avgHeartrate,
          maxHeartrate: w.maxHeartrate,
          workoutStrain: w.workoutStrain != null ? String(w.workoutStrain) : null,
          calories: w.calories,
          externalActivityId: w.externalActivityId,
          metricsSource: w.metricsSource,
        })
        .returning();
      for (const l of w.logs) {
        await insertLog(tx, l, workout.id);
      }
    }

    for (const l of payload.looseLogs ?? []) {
      await insertLog(tx, l, null);
    }

    if (payload.dailyMetrics.length) {
      await tx.insert(dailyMetrics).values(
        payload.dailyMetrics.map((m) => ({
          metricDate: m.metricDate,
          recoveryScore: m.recoveryScore,
          hrvMs: m.hrvMs,
          restingHr: m.restingHr,
          sleepPerformance: m.sleepPerformance,
          sleepDurationMinutes: m.sleepDurationMinutes,
          dayStrain: m.dayStrain != null ? String(m.dayStrain) : null,
          source: m.source,
          rawJson: m.rawJson,
        })),
      );
    }
    if (payload.settings.length) {
      await tx.insert(appSettings).values(payload.settings);
    }
  });
}

export function registerExportImportTools(server: McpServer, db: Db) {
  server.registerTool(
    "export_backup",
    {
      title: "Export backup",
      description:
        "Full personal backup as one JSON object: exercises (incl. images/voice lines), templates, complete history with logs, daily metrics incl. raw payloads, and settings. For migration/recovery — contains personal data; don't share it.",
      inputSchema: {},
    },
    async () => ok(await buildBackup(db)),
  );

  server.registerTool(
    "export_shareable_config",
    {
      title: "Export shareable config",
      description:
        "Routine-only export, safe to hand to someone else: exercises (name/durations/order) and templates. No history, logs, images, or wearable data; voice lines stripped unless includeVoiceLines is true.",
      inputSchema: { includeVoiceLines: z.boolean().optional() },
    },
    async ({ includeVoiceLines }) => {
      const rows = await db
        .select()
        .from(exercises)
        .where(isNull(exercises.retiredAt))
        .orderBy(asc(exercises.sortOrder), asc(exercises.id));
      const templates = await db.select().from(workoutTemplates);
      const payload: ShareablePayload = {
        version: 1,
        kind: "shareable_config",
        exportedAt: new Date().toISOString(),
        exercises: rows.map((e) => ({
          name: e.name,
          durationSeconds: e.durationSeconds,
          restAfterSeconds: e.restAfterSeconds,
          sortOrder: e.sortOrder,
          ...(includeVoiceLines
            ? { voiceStart: e.voiceStart, voiceEnd: e.voiceEnd }
            : {}),
        })),
        templates: templates.map((t) => ({
          name: t.name,
          exercisesJson: t.exercisesJson,
          isActive: t.isActive,
        })),
      };
      return ok(payload);
    },
  );

  server.registerTool(
    "import_backup",
    {
      title: "Import backup",
      description:
        "REPLACE-ONLY restore from an export_backup payload: wipes ALL existing data first. Call with confirm=false (default) to preview what would happen; the wipe only runs with confirm=true, and only after the user has explicitly agreed to the preview.",
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
      const parsed = backupPayloadSchema.safeParse(raw);
      if (!parsed.success) {
        return err(
          `not a valid backup payload: ${parsed.error.issues
            .slice(0, 3)
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")}`,
        );
      }
      const p = parsed.data;
      const preview = {
        exportedAt: p.exportedAt,
        exercises: p.exercises.length,
        templates: p.templates.length,
        workouts: p.history.length,
        exerciseLogs:
          p.history.reduce((n, w) => n + w.logs.length, 0) +
          (p.looseLogs?.length ?? 0),
        dailyMetrics: p.dailyMetrics.length,
        settings: p.settings.length,
      };
      if (!confirm) {
        return ok({
          preview,
          warning:
            "import_backup REPLACES everything — all current exercises, history, metrics, templates and settings will be wiped first. Confirm with the user, then call again with confirm=true.",
        });
      }
      await restoreBackup(db, p);
      return ok({ restored: preview });
    },
  );

  server.registerTool(
    "import_shareable_config",
    {
      title: "Import shareable config",
      description:
        "Additive import of a shareable config: with confirm=false (default) returns a preview of which exercises/templates would be added or updated; confirm=true applies it. Never touches history, logs, images, or metrics.",
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
      const parsed = shareablePayloadSchema.safeParse(raw);
      if (!parsed.success) {
        return err(
          `not a valid shareable config: ${parsed.error.issues
            .slice(0, 3)
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")}`,
        );
      }
      const p = parsed.data;
      const current = await db.select().from(exercises);
      const byName = new Map(current.map((e) => [e.name, e]));
      const existingTemplates = new Set(
        (await db.select().from(workoutTemplates)).map((t) => t.name),
      );

      const adds = p.exercises.filter((e) => !byName.has(e.name)).map((e) => e.name);
      const updates = p.exercises.filter((e) => byName.has(e.name)).map((e) => e.name);
      const templateAdds = p.templates
        .filter((t) => !existingTemplates.has(t.name))
        .map((t) => t.name);

      if (!confirm) {
        return ok({
          preview: {
            willAddExercises: adds,
            willUpdateExercises: updates,
            willAddTemplates: templateAdds,
            skippedExistingTemplates: p.templates.length - templateAdds.length,
          },
          note: "additive only — no history, logs or personal data touched. Call again with confirm=true to apply.",
        });
      }

      for (const e of p.exercises) {
        const existing = byName.get(e.name);
        if (existing) {
          await db
            .update(exercises)
            .set({
              durationSeconds: e.durationSeconds,
              restAfterSeconds: e.restAfterSeconds,
              sortOrder: e.sortOrder,
              ...(e.voiceStart !== undefined ? { voiceStart: e.voiceStart } : {}),
              ...(e.voiceEnd !== undefined ? { voiceEnd: e.voiceEnd } : {}),
              retiredAt: null,
              updatedAt: new Date(),
            })
            .where(eq(exercises.id, existing.id));
        } else {
          await db.insert(exercises).values({
            name: e.name,
            durationSeconds: e.durationSeconds,
            restAfterSeconds: e.restAfterSeconds,
            sortOrder: e.sortOrder,
            voiceStart: e.voiceStart ?? null,
            voiceEnd: e.voiceEnd ?? null,
          });
        }
      }
      const newTemplates = p.templates.filter((t) => !existingTemplates.has(t.name));
      if (newTemplates.length) {
        await db.insert(workoutTemplates).values(
          newTemplates.map((t) => ({
            name: t.name,
            exercisesJson: t.exercisesJson,
            isActive: false,
          })),
        );
      }
      return ok({
        addedExercises: adds,
        updatedExercises: updates,
        addedTemplates: templateAdds,
      });
    },
  );
}
