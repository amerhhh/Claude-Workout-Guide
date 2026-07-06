import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { asc, eq, inArray, isNull } from "drizzle-orm";
import {
  createExerciseSchema,
  updateExerciseSchema,
  reorderExercisesSchema,
  setSettingSchema,
  SETTING_SCHEMAS,
  type SettingKey,
} from "@workoutguide/shared";
import type { Db } from "../db/index.js";
import {
  appSettings,
  exercises,
  exerciseLogs,
  workoutTemplates,
} from "../db/schema.js";
import { ok, err } from "../lib/respond.js";

export async function getSettingValue(
  db: Db,
  key: SettingKey,
): Promise<number | string | null> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key));
  if (!row) return null;
  const parsed = SETTING_SCHEMAS[key].safeParse(row.value);
  return parsed.success ? parsed.data : null;
}

async function exerciseHasLogs(db: Db, exerciseId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: exerciseLogs.id })
    .from(exerciseLogs)
    .where(eq(exerciseLogs.exerciseId, exerciseId))
    .limit(1);
  return row != null;
}

const presentExercise = ({ imageData, ...rest }: typeof exercises.$inferSelect) => ({
  ...rest,
  hasImage: imageData != null,
});

type TemplateEntry = {
  name: string;
  durationSeconds: number;
  restAfterSeconds: number;
  sortOrder: number;
  voiceStart: string | null;
  voiceEnd: string | null;
  imageData: string | null;
};

export function registerConfigTools(server: McpServer, db: Db) {
  server.registerTool(
    "list_exercises",
    {
      title: "List exercises",
      description:
        "Full exercise list in rotation order. Set includeRetired to also see exercises kept only for their logged history.",
      inputSchema: { includeRetired: z.boolean().optional() },
    },
    async ({ includeRetired }) => {
      const rows = await db
        .select()
        .from(exercises)
        .where(includeRetired ? undefined : isNull(exercises.retiredAt))
        .orderBy(asc(exercises.sortOrder), asc(exercises.id));
      return ok(rows.map(presentExercise));
    },
  );

  server.registerTool(
    "add_exercise",
    {
      title: "Add exercise",
      description:
        "Creates an exercise. Omitted duration/rest fall back to the default_duration_seconds / default_rest_seconds settings (then 30s/25s).",
      inputSchema: createExerciseSchema.shape,
    },
    async (input) => {
      const parsed = createExerciseSchema.parse(input);
      const defaultDuration =
        (await getSettingValue(db, "default_duration_seconds")) as number | null;
      const defaultRest =
        (await getSettingValue(db, "default_rest_seconds")) as number | null;
      const [maxSort] = await db
        .select({ sortOrder: exercises.sortOrder })
        .from(exercises)
        .orderBy(asc(exercises.sortOrder))
        .then((rows) => rows.slice(-1));
      const [row] = await db
        .insert(exercises)
        .values({
          name: parsed.name,
          durationSeconds: parsed.durationSeconds ?? defaultDuration ?? 30,
          restAfterSeconds: parsed.restAfterSeconds ?? defaultRest ?? 25,
          sortOrder: parsed.sortOrder ?? (maxSort ? maxSort.sortOrder + 1 : 0),
          voiceStart: parsed.voiceStart ?? null,
          voiceEnd: parsed.voiceEnd ?? null,
          imageData: parsed.imageData ?? null,
        })
        .returning();
      return ok(presentExercise(row));
    },
  );

  server.registerTool(
    "update_exercise",
    {
      title: "Update exercise",
      description:
        "Partially updates one exercise (name, durations, voice lines, image, sort order).",
      inputSchema: { id: z.number().int(), ...updateExerciseSchema.shape },
    },
    async ({ id, ...rest }) => {
      const parsed = updateExerciseSchema.parse(rest);
      if (Object.keys(parsed).length === 0) return err("no fields to update");
      const [row] = await db
        .update(exercises)
        .set({ ...parsed, updatedAt: new Date() })
        .where(eq(exercises.id, id))
        .returning();
      if (!row) return err(`exercise ${id} not found`);
      return ok(presentExercise(row));
    },
  );

  server.registerTool(
    "delete_exercise",
    {
      title: "Delete exercise",
      description:
        "Removes an exercise from the rotation. If it has logged history it is retired (history preserved, hidden from lists) rather than hard-deleted.",
      inputSchema: { id: z.number().int() },
    },
    async ({ id }) => {
      const [row] = await db.select().from(exercises).where(eq(exercises.id, id));
      if (!row) return err(`exercise ${id} not found`);
      if (await exerciseHasLogs(db, id)) {
        await db
          .update(exercises)
          .set({ retiredAt: new Date(), updatedAt: new Date() })
          .where(eq(exercises.id, id));
        return ok({
          id,
          action: "retired",
          note: "exercise has logged history, so it was retired (out of rotation, history kept)",
        });
      }
      await db.delete(exercises).where(eq(exercises.id, id));
      return ok({ id, action: "deleted" });
    },
  );

  server.registerTool(
    "reorder_exercises",
    {
      title: "Reorder exercises",
      description: "Bulk-updates sortOrder for the given exercise ids.",
      inputSchema: reorderExercisesSchema.shape,
    },
    async (input) => {
      const { order } = reorderExercisesSchema.parse(input);
      for (const { id, sortOrder } of order) {
        await db
          .update(exercises)
          .set({ sortOrder, updatedAt: new Date() })
          .where(eq(exercises.id, id));
      }
      const rows = await db
        .select()
        .from(exercises)
        .where(isNull(exercises.retiredAt))
        .orderBy(asc(exercises.sortOrder), asc(exercises.id));
      return ok(rows.map(presentExercise));
    },
  );

  server.registerTool(
    "list_templates",
    {
      title: "List templates",
      description: "All saved workout templates (snapshots of an exercise rotation).",
      inputSchema: {},
    },
    async () => {
      const rows = await db.select().from(workoutTemplates);
      return ok(
        rows.map((t) => ({
          ...t,
          exerciseNames: (JSON.parse(t.exercisesJson) as TemplateEntry[]).map(
            (e) => e.name,
          ),
        })),
      );
    },
  );

  server.registerTool(
    "save_template",
    {
      title: "Save template",
      description: "Snapshots the current (non-retired) exercise rotation as a named template.",
      inputSchema: { name: z.string().min(1) },
    },
    async ({ name }) => {
      const rows = await db
        .select()
        .from(exercises)
        .where(isNull(exercises.retiredAt))
        .orderBy(asc(exercises.sortOrder), asc(exercises.id));
      if (rows.length === 0) return err("no exercises configured — nothing to snapshot");
      const snapshot: TemplateEntry[] = rows.map((e) => ({
        name: e.name,
        durationSeconds: e.durationSeconds,
        restAfterSeconds: e.restAfterSeconds,
        sortOrder: e.sortOrder,
        voiceStart: e.voiceStart,
        voiceEnd: e.voiceEnd,
        imageData: e.imageData,
      }));
      const [row] = await db
        .insert(workoutTemplates)
        .values({ name, exercisesJson: JSON.stringify(snapshot) })
        .returning();
      return ok({ id: row.id, name: row.name, exerciseCount: snapshot.length });
    },
  );

  server.registerTool(
    "switch_template",
    {
      title: "Switch template",
      description:
        "Replaces the current rotation with a template's snapshot. Exercises are matched by name: matching ones are updated (and un-retired), new ones created; current exercises missing from the template are deleted if they have no history, retired if they do.",
      inputSchema: { id: z.number().int() },
    },
    async ({ id }) => {
      const [template] = await db
        .select()
        .from(workoutTemplates)
        .where(eq(workoutTemplates.id, id));
      if (!template) return err(`template ${id} not found`);
      const snapshot = JSON.parse(template.exercisesJson) as TemplateEntry[];

      const current = await db.select().from(exercises);
      const byName = new Map(current.map((e) => [e.name, e]));
      const summary = { created: 0, updated: 0, retired: 0, deleted: 0 };

      for (const entry of snapshot) {
        const existing = byName.get(entry.name);
        if (existing) {
          await db
            .update(exercises)
            .set({
              durationSeconds: entry.durationSeconds,
              restAfterSeconds: entry.restAfterSeconds,
              sortOrder: entry.sortOrder,
              voiceStart: entry.voiceStart,
              voiceEnd: entry.voiceEnd,
              imageData: entry.imageData ?? existing.imageData,
              retiredAt: null,
              updatedAt: new Date(),
            })
            .where(eq(exercises.id, existing.id));
          summary.updated++;
        } else {
          await db.insert(exercises).values(entry);
          summary.created++;
        }
      }

      const snapshotNames = new Set(snapshot.map((e) => e.name));
      for (const e of current) {
        if (snapshotNames.has(e.name) || e.retiredAt != null) continue;
        if (await exerciseHasLogs(db, e.id)) {
          await db
            .update(exercises)
            .set({ retiredAt: new Date(), updatedAt: new Date() })
            .where(eq(exercises.id, e.id));
          summary.retired++;
        } else {
          await db.delete(exercises).where(eq(exercises.id, e.id));
          summary.deleted++;
        }
      }

      await db
        .update(workoutTemplates)
        .set({ isActive: false })
        .where(eq(workoutTemplates.isActive, true));
      await db
        .update(workoutTemplates)
        .set({ isActive: true })
        .where(eq(workoutTemplates.id, id));

      return ok({ templateId: id, templateName: template.name, ...summary });
    },
  );

  server.registerTool(
    "delete_template",
    {
      title: "Delete template",
      description: "Removes a saved template (does not touch current exercises).",
      inputSchema: { id: z.number().int() },
    },
    async ({ id }) => {
      const [row] = await db
        .delete(workoutTemplates)
        .where(eq(workoutTemplates.id, id))
        .returning();
      if (!row) return err(`template ${id} not found`);
      return ok({ id, deleted: true });
    },
  );

  server.registerTool(
    "get_settings",
    {
      title: "Get settings",
      description:
        "All runtime preferences from app_settings, plus the allowed keys and their value shapes.",
      inputSchema: {},
    },
    async () => {
      const rows = await db.select().from(appSettings);
      return ok({
        settings: Object.fromEntries(rows.map((r) => [r.key, r.value])),
        allowedKeys: {
          default_rest_seconds: "integer 5-600",
          default_duration_seconds: "integer 5-600",
          units: "metric | imperial",
          coaching_intensity: "chill | standard | beast",
        },
      });
    },
  );

  server.registerTool(
    "set_setting",
    {
      title: "Set setting",
      description:
        "Updates one runtime preference conversationally (no redeploy). Key must be one of the whitelisted keys; the value is validated per key.",
      inputSchema: setSettingSchema.shape,
    },
    async (input) => {
      const { key, value } = setSettingSchema.parse(input);
      const validated = SETTING_SCHEMAS[key].safeParse(value);
      if (!validated.success) {
        return err(
          `invalid value for ${key}: ${validated.error.issues[0]?.message ?? "bad value"}`,
        );
      }
      const stored = String(validated.data);
      const [existing] = await db
        .select()
        .from(appSettings)
        .where(eq(appSettings.key, key));
      if (existing) {
        await db
          .update(appSettings)
          .set({ value: stored, updatedAt: new Date() })
          .where(eq(appSettings.key, key));
      } else {
        await db.insert(appSettings).values({ key, value: stored });
      }
      return ok({ key, value: stored });
    },
  );
}
