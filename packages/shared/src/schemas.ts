import { z } from "zod";

// ---------------------------------------------------------------------------
// Exercises
// ---------------------------------------------------------------------------

export const createExerciseSchema = z.object({
  name: z.string().min(1),
  durationSeconds: z.number().int().positive().optional(),
  restAfterSeconds: z.number().int().nonnegative().optional(),
  sortOrder: z.number().int().optional(),
  voiceStart: z.string().nullable().optional(),
  voiceEnd: z.string().nullable().optional(),
  imageData: z.string().nullable().optional(),
});
export type CreateExercise = z.infer<typeof createExerciseSchema>;

export const updateExerciseSchema = createExerciseSchema.partial();
export type UpdateExercise = z.infer<typeof updateExerciseSchema>;

export const reorderExercisesSchema = z.object({
  order: z
    .array(z.object({ id: z.number().int(), sortOrder: z.number().int() }))
    .min(1),
});
export type ReorderExercises = z.infer<typeof reorderExercisesSchema>;

// ---------------------------------------------------------------------------
// Health / wearable metrics (§5b)
// ---------------------------------------------------------------------------

/** Priority per §5b: richer source wins per field. Unknown sources rank with manual. */
export const METRIC_SOURCE_PRIORITY: Record<string, number> = {
  apple_health: 3,
  whoop: 2,
  garmin: 2,
  manual: 1,
};

export const metricSourceSchema = z
  .string()
  .min(1)
  .default("manual");

export const logDailyMetricsSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
  recoveryScore: z.number().int().min(0).max(100).nullable().optional(),
  hrvMs: z.number().int().positive().nullable().optional(),
  restingHr: z.number().int().positive().nullable().optional(),
  sleepPerformance: z.number().int().min(0).max(100).nullable().optional(),
  sleepDurationMinutes: z.number().int().nonnegative().nullable().optional(),
  dayStrain: z.number().min(0).max(21).nullable().optional(),
  source: metricSourceSchema.optional(),
  rawJson: z.string().nullable().optional(),
});
export type LogDailyMetrics = z.infer<typeof logDailyMetricsSchema>;

export const getDailyMetricsSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .refine((v) => !(v.date && (v.fromDate || v.toDate)), {
    message: "use either date or fromDate/toDate, not both",
  });
export type GetDailyMetrics = z.infer<typeof getDailyMetricsSchema>;

export const attachWorkoutMetricsSchema = z.object({
  workoutHistoryId: z.number().int(),
  avgHeartrate: z.number().int().positive().nullable().optional(),
  maxHeartrate: z.number().int().positive().nullable().optional(),
  workoutStrain: z.number().min(0).max(21).nullable().optional(),
  calories: z.number().int().nonnegative().nullable().optional(),
  externalActivityId: z.string().nullable().optional(),
  source: metricSourceSchema.optional(),
});
export type AttachWorkoutMetrics = z.infer<typeof attachWorkoutMetricsSchema>;

// ---------------------------------------------------------------------------
// Runtime settings (§6 layer 2) — whitelisted keys, value shape per key
// ---------------------------------------------------------------------------

export const SETTING_SCHEMAS = {
  default_rest_seconds: z.coerce.number().int().min(5).max(600),
  default_duration_seconds: z.coerce.number().int().min(5).max(600),
  units: z.enum(["metric", "imperial"]),
  coaching_intensity: z.enum(["chill", "standard", "beast"]),
  timezone: z.string().refine(
    (tz) => {
      try {
        new Intl.DateTimeFormat("en-CA", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    },
    { message: "must be a valid IANA timezone, e.g. America/Los_Angeles" },
  ),
} as const;

export type SettingKey = keyof typeof SETTING_SCHEMAS;
export const settingKeySchema = z.enum(
  Object.keys(SETTING_SCHEMAS) as [SettingKey, ...SettingKey[]],
);

export const setSettingSchema = z.object({
  key: settingKeySchema,
  value: z.string().min(1),
});
export type SetSetting = z.infer<typeof setSettingSchema>;

// ---------------------------------------------------------------------------
// Training plans & calendar (v0.6, SPEC §5c)
// ---------------------------------------------------------------------------

export const PLAN_CATEGORIES = [
  "running",
  "strength",
  "stretching",
  "mind_body",
  "other",
] as const;
export const planCategorySchema = z.enum(PLAN_CATEGORIES);
export type PlanCategory = z.infer<typeof planCategorySchema>;

export const timeOfDaySchema = z.enum(["morning", "afternoon", "evening"]);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM 24h");

export const plannedSessionInputSchema = z.object({
  date: dateStr,
  title: z.string().min(1),
  timeOfDay: timeOfDaySchema.nullable().optional(),
  plannedTime: timeStr.nullable().optional(),
  notes: z.string().nullable().optional(),
  templateName: z.string().nullable().optional(),
});
export type PlannedSessionInput = z.infer<typeof plannedSessionInputSchema>;

/** Upload format for a whole plan (import_training_plan). */
export const trainingPlanPayloadSchema = z.object({
  version: z.literal(1),
  kind: z.literal("training_plan"),
  planName: z.string().min(1),
  category: planCategorySchema.optional(),
  startDate: dateStr.optional(),
  endDate: dateStr.optional(),
  sessions: z.array(plannedSessionInputSchema).min(1),
});
export type TrainingPlanPayload = z.infer<typeof trainingPlanPayloadSchema>;

export const sessionStatusOverrideSchema = z.enum([
  "skipped",
  "moved",
  "completed",
]);

// ---------------------------------------------------------------------------
// Export / import payloads (§5 export tables + §8 decisions)
// ---------------------------------------------------------------------------

export const exportedExerciseSchema = z.object({
  name: z.string().min(1),
  durationSeconds: z.number().int().positive(),
  restAfterSeconds: z.number().int().nonnegative(),
  sortOrder: z.number().int(),
  voiceStart: z.string().nullable(),
  voiceEnd: z.string().nullable(),
  imageData: z.string().nullable(),
  retiredAt: z.string().nullable().optional(),
});

export const exportedTemplateSchema = z.object({
  name: z.string().min(1),
  exercisesJson: z.string(),
  isActive: z.boolean(),
});

export const exportedLogSchema = z.object({
  exerciseName: z.string(),
  repsText: z.string().nullable(),
  feedbackText: z.string().nullable(),
  startedAt: z.string().nullable(),
  plannedDurationSeconds: z.number().nullable(),
  actualDurationSeconds: z.number().nullable(),
  endedEarly: z.boolean(),
  plannedRestSeconds: z.number().nullable(),
  actualRestSeconds: z.number().nullable(),
  restExtended: z.boolean(),
  recordedAt: z.string(),
});

export const exportedWorkoutSchema = z.object({
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  exercisesCompleted: z.number().nullable(),
  exercisesJson: z.string().nullable(),
  totalDurationSeconds: z.number().nullable(),
  notes: z.string().nullable(),
  avgHeartrate: z.number().nullable(),
  maxHeartrate: z.number().nullable(),
  workoutStrain: z.number().nullable(),
  calories: z.number().nullable(),
  externalActivityId: z.string().nullable(),
  metricsSource: z.string().nullable(),
  logs: z.array(exportedLogSchema),
});

export const exportedDailyMetricSchema = z.object({
  metricDate: z.string(),
  recoveryScore: z.number().nullable(),
  hrvMs: z.number().nullable(),
  restingHr: z.number().nullable(),
  sleepPerformance: z.number().nullable(),
  sleepDurationMinutes: z.number().nullable(),
  dayStrain: z.number().nullable(),
  source: z.string(),
  rawJson: z.string().nullable(),
});

export const exportedSettingSchema = z.object({
  key: z.string(),
  value: z.string(),
});

export const exportedIdeaSchema = z.object({
  content: z.string(),
  context: z.string().nullable(),
  /** startedAt ISO of the linked workout — ids renumber on restore */
  workoutStartedAt: z.string().nullable(),
  createdAt: z.string(),
});

export const exportedPlanSchema = z.object({
  name: z.string(),
  category: z.string(),
  active: z.boolean(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  sessions: z.array(
    z.object({
      plannedDate: z.string(),
      timeOfDay: z.string().nullable(),
      plannedTime: z.string().nullable(),
      title: z.string(),
      notes: z.string().nullable(),
      templateName: z.string().nullable(),
      statusOverride: z.string().nullable(),
      completedWorkoutStartedAt: z.string().nullable(),
    }),
  ),
});

/** Full personal backup (export_backup / import_backup). */
export const backupPayloadSchema = z.object({
  version: z.literal(1),
  kind: z.literal("backup"),
  exportedAt: z.string(),
  exercises: z.array(exportedExerciseSchema),
  templates: z.array(exportedTemplateSchema),
  history: z.array(exportedWorkoutSchema),
  /** attempts logged outside any workout session — still coaching history */
  looseLogs: z.array(exportedLogSchema).optional(),
  dailyMetrics: z.array(exportedDailyMetricSchema),
  settings: z.array(exportedSettingSchema),
  /** v0.6 — optional so pre-0.6 backups still validate */
  ideas: z.array(exportedIdeaSchema).optional(),
  plans: z.array(exportedPlanSchema).optional(),
});
export type BackupPayload = z.infer<typeof backupPayloadSchema>;

/** Routine-only shareable config (export_shareable_config / import_shareable_config). */
export const shareablePayloadSchema = z.object({
  version: z.literal(1),
  kind: z.literal("shareable_config"),
  exportedAt: z.string(),
  exercises: z.array(
    exportedExerciseSchema.omit({ imageData: true }).extend({
      voiceStart: z.string().nullable().optional(),
      voiceEnd: z.string().nullable().optional(),
    }),
  ),
  templates: z.array(exportedTemplateSchema),
});
export type ShareablePayload = z.infer<typeof shareablePayloadSchema>;
