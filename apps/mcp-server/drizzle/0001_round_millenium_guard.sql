CREATE TABLE "ideas" (
	"id" serial PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"context" text,
	"workout_history_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "planned_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan_id" integer NOT NULL,
	"planned_date" date NOT NULL,
	"time_of_day" text,
	"planned_time" text,
	"title" text NOT NULL,
	"notes" text,
	"template_name" text,
	"status_override" text,
	"completed_workout_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"start_date" date,
	"end_date" date,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_workout_history_id_workout_history_id_fk" FOREIGN KEY ("workout_history_id") REFERENCES "public"."workout_history"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_sessions" ADD CONSTRAINT "planned_sessions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_sessions" ADD CONSTRAINT "planned_sessions_completed_workout_id_workout_history_id_fk" FOREIGN KEY ("completed_workout_id") REFERENCES "public"."workout_history"("id") ON DELETE no action ON UPDATE no action;