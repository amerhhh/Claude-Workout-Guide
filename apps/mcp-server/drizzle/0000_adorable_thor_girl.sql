CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"metric_date" date NOT NULL,
	"recovery_score" integer,
	"hrv_ms" integer,
	"resting_hr" integer,
	"sleep_performance" integer,
	"sleep_duration_minutes" integer,
	"day_strain" numeric(5, 2),
	"source" text DEFAULT 'manual' NOT NULL,
	"raw_json" text,
	"recorded_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "daily_metrics_metric_date_unique" UNIQUE("metric_date")
);
--> statement-breakpoint
CREATE TABLE "exercise_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"exercise_id" integer NOT NULL,
	"workout_history_id" integer,
	"reps_text" text,
	"feedback_text" text,
	"started_at" timestamp,
	"planned_duration_seconds" integer,
	"actual_duration_seconds" integer,
	"ended_early" boolean DEFAULT false NOT NULL,
	"planned_rest_seconds" integer,
	"rest_started_at" timestamp,
	"actual_rest_seconds" integer,
	"rest_extended" boolean DEFAULT false NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercises" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"duration_seconds" integer DEFAULT 30 NOT NULL,
	"rest_after_seconds" integer DEFAULT 25 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"voice_start" text,
	"voice_end" text,
	"image_data" text,
	"retired_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workout_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"started_at" timestamp NOT NULL,
	"completed_at" timestamp,
	"exercises_completed" integer DEFAULT 0,
	"exercises_json" text,
	"total_duration_seconds" integer DEFAULT 0,
	"notes" text,
	"avg_heartrate" integer,
	"max_heartrate" integer,
	"workout_strain" numeric(5, 2),
	"calories" integer,
	"external_activity_id" text,
	"metrics_source" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workout_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"exercises_json" text NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exercise_logs" ADD CONSTRAINT "exercise_logs_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_logs" ADD CONSTRAINT "exercise_logs_workout_history_id_workout_history_id_fk" FOREIGN KEY ("workout_history_id") REFERENCES "public"."workout_history"("id") ON DELETE no action ON UPDATE no action;