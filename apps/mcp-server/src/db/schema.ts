import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  boolean,
  numeric,
  date,
} from "drizzle-orm/pg-core";

export const exercises = pgTable("exercises", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  durationSeconds: integer("duration_seconds").notNull().default(30),
  restAfterSeconds: integer("rest_after_seconds").notNull().default(25),
  sortOrder: integer("sort_order").notNull().default(0),
  voiceStart: text("voice_start"),
  voiceEnd: text("voice_end"),
  imageData: text("image_data"),
  // not in SPEC §4 — exercises with logged history can't be hard-deleted
  // (FK from exercise_logs), so template switches retire them instead
  retiredAt: timestamp("retired_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const workoutHistory = pgTable("workout_history", {
  id: serial("id").primaryKey(),
  startedAt: timestamp("started_at").notNull(),
  completedAt: timestamp("completed_at"),
  exercisesCompleted: integer("exercises_completed").default(0),
  exercisesJson: text("exercises_json"),
  totalDurationSeconds: integer("total_duration_seconds").default(0),
  notes: text("notes"),
  // wearable enrichment (§4, attached post-session via attach_workout_metrics)
  avgHeartrate: integer("avg_heartrate"),
  maxHeartrate: integer("max_heartrate"),
  workoutStrain: numeric("workout_strain", { precision: 5, scale: 2 }),
  calories: integer("calories"),
  externalActivityId: text("external_activity_id"),
  metricsSource: text("metrics_source"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const exerciseLogs = pgTable("exercise_logs", {
  id: serial("id").primaryKey(),
  exerciseId: integer("exercise_id")
    .notNull()
    .references(() => exercises.id),
  workoutHistoryId: integer("workout_history_id").references(
    () => workoutHistory.id,
  ),
  repsText: text("reps_text"),
  feedbackText: text("feedback_text"),
  startedAt: timestamp("started_at"),
  plannedDurationSeconds: integer("planned_duration_seconds"),
  actualDurationSeconds: integer("actual_duration_seconds"),
  endedEarly: boolean("ended_early").notNull().default(false),
  plannedRestSeconds: integer("planned_rest_seconds"),
  // not in SPEC §4 — required so check_time can measure an in-flight rest
  restStartedAt: timestamp("rest_started_at"),
  actualRestSeconds: integer("actual_rest_seconds"),
  restExtended: boolean("rest_extended").notNull().default(false),
  recordedAt: timestamp("recorded_at").notNull().defaultNow(),
});

export const dailyMetrics = pgTable("daily_metrics", {
  id: serial("id").primaryKey(),
  metricDate: date("metric_date").notNull().unique(),
  recoveryScore: integer("recovery_score"),
  hrvMs: integer("hrv_ms"),
  restingHr: integer("resting_hr"),
  sleepPerformance: integer("sleep_performance"),
  sleepDurationMinutes: integer("sleep_duration_minutes"),
  dayStrain: numeric("day_strain", { precision: 5, scale: 2 }),
  source: text("source").notNull().default("manual"),
  rawJson: text("raw_json"),
  recordedAt: timestamp("recorded_at").notNull().defaultNow(),
});

export const workoutTemplates = pgTable("workout_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  exercisesJson: text("exercises_json").notNull(),
  isActive: boolean("is_active").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// --- v0.6 ---

/** Freeform thoughts captured mid-session (runs especially) — first-class,
 *  searchable, separate from workout notes. */
export const ideas = pgTable("ideas", {
  id: serial("id").primaryKey(),
  content: text("content").notNull(),
  context: text("context"), // e.g. 'run', 'rest day'
  workoutHistoryId: integer("workout_history_id").references(
    () => workoutHistory.id,
  ),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** A training plan (running, stretching, mind-body, …). The calendar is a
 *  query across all active plans' sessions — not a table. */
export const plans = pgTable("plans", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull().default("other"),
  active: boolean("active").notNull().default(true),
  startDate: date("start_date"),
  endDate: date("end_date"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const plannedSessions = pgTable("planned_sessions", {
  id: serial("id").primaryKey(),
  planId: integer("plan_id")
    .notNull()
    .references(() => plans.id),
  plannedDate: date("planned_date").notNull(),
  timeOfDay: text("time_of_day"), // morning | afternoon | evening
  plannedTime: text("planned_time"), // HH:MM, wins over timeOfDay
  title: text("title").notNull(),
  notes: text("notes"),
  templateName: text("template_name"),
  statusOverride: text("status_override"), // skipped | moved | completed
  completedWorkoutId: integer("completed_workout_id").references(
    () => workoutHistory.id,
  ),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
