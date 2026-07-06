# WorkoutGuide MCP — Full Specification

**Version:** 0.5 · **Created:** 2026-07-04 · **Last updated:** 2026-07-05

| Version | Date | Changes |
|---|---|---|
| 0.1 | 2026-07-04 | Initial draft: MCP architecture, schema, tools, export/import, skill outline |
| 0.2 | 2026-07-05 | Added totem/Whoop wearable integration (§5b, `daily_metrics`); §6 Configuration & Auth; resolved hosting (Replit) |
| 0.3 | 2026-07-05 | `check_time` server-clock tool; `app_settings` + settings tools; HANDOFF.md convention; enriched coaching skill (§6a) with readiness rules & overload discipline borrowed from claude-coach skill |
| 0.4 | 2026-07-05 | **All open questions resolved** (§8): voice lines stripped by default w/ flag; two export tools; import_backup replace-only w/ confirmation; raw_json included in backups; manual metrics entry path added; prototype data = fresh start (no data migration). **Spec is build-ready.** |
| 0.5 | 2026-07-05 | §5b generalized to multi-source health data: **Apple Health (Claude iOS app) is now the primary source**, totem/Whoop demoted to optional enrichment, manual entry as fallback; per-field merge + dedup/priority rules added |

**Status:** Draft for review. Intended to be pasted into a Claude Project, refined, then handed to a new build session.

**Origin note:** This app was originally prototyped as a standalone full-stack web app (React + Express + Postgres) with in-app TTS/STT voice control. That prototype is being retired in favor of this design: an MCP server with no web frontend, where Claude itself is the conversational coach.

---

## 1. Purpose

A guided workout companion that lives entirely inside conversations with Claude. No app to open, no screen to look at mid-workout — you talk to Claude ("let's start my workout," "how was that last set?"), and Claude uses this MCP server to read/write your exercise config, log what happened, track streaks and progress, and give personalized, motivating coaching based on your history.

---

## 2. Architecture

```
Claude (desktop / mobile / web — any MCP-capable client)
   │   conversation IS the interface — tone, pacing, encouragement
   │   all handled by Claude, guided by a Skill (see §6)
   ▼
MCP Server (single Node process)
   │   tools = actions (write), resources = context (read)
   ▼
PostgreSQL (schema in §4)
```

**No web frontend. No separate REST API.** One MCP server process owns all reads/writes to Postgres. This replaces the earlier prototype's `apps/web` (React/Vite) and `apps/server` (Express REST) entirely.

**Hosting:** Replit (paid, always-on tier), deployed via GitHub sync — repo is the source of truth, never edit directly on Replit.

---

## 3. Repo shape

```
WorkoutGuide/
  apps/mcp-server/
    src/
      db/
        schema.ts        # Drizzle schema (see §4)
        index.ts          # db connection
      tools/
        workout.ts         # start/end exercise, rest, complete, feedback
        config.ts           # exercise + template CRUD
        history.ts           # queries, streak, progress summary, notes
        exportImport.ts       # backup/share export + import tools
      index.ts             # MCP server entrypoint, registers all tools
    package.json
    drizzle.config.ts
  packages/shared/
    src/schemas.ts        # zod schemas/types, shared source of truth
  skills/
    workout-coach.md       # coaching personality & conversation flow (see §6)
  HANDOFF.md              # cross-session log: every Claude session (chat/Code/Cowork) reads first, appends last
  SPEC.md                 # this file
```

---

## 4. Database schema (Postgres via Drizzle)

Carried over from the prototype, since the granular tracking fields are exactly what make personalized coaching possible.

### `exercises`
| column | type | notes |
|---|---|---|
| id | serial PK | |
| name | text NOT NULL | |
| duration_seconds | integer NOT NULL default 30 | planned work time |
| rest_after_seconds | integer NOT NULL default 25 | planned rest time |
| sort_order | integer NOT NULL default 0 | |
| voice_start | text nullable | optional custom coaching line to open the exercise |
| voice_end | text nullable | optional custom coaching line to close the exercise |
| image_data | text nullable | base64 image, personal only — excluded from shareable export |
| created_at / updated_at | timestamp | |

### `workout_history`
| column | type | notes |
|---|---|---|
| id | serial PK | |
| started_at | timestamp NOT NULL | |
| completed_at | timestamp nullable | |
| exercises_completed | integer default 0 | |
| exercises_json | text nullable | snapshot of exercise ids used this session |
| total_duration_seconds | integer default 0 | |
| notes | text nullable | freeform session notes |
| created_at | timestamp | |

### `exercise_logs`
Per-exercise-attempt record — the detailed data that powers "last time you only did 4 reps in 20 seconds, then rested 30 seconds" style callouts.

| column | type | notes |
|---|---|---|
| id | serial PK | |
| exercise_id | integer FK → exercises | |
| workout_history_id | integer FK → workout_history, nullable | |
| reps_text | text nullable | parsed/reported rep count |
| feedback_text | text nullable | freeform comment ("felt easy", "shoulder tight") |
| started_at | timestamp nullable | when the exercise attempt began |
| planned_duration_seconds | integer nullable | snapshot of exercise's configured duration |
| actual_duration_seconds | integer nullable | how long they actually worked |
| ended_early | boolean NOT NULL default false | true if stopped before planned duration |
| planned_rest_seconds | integer nullable | snapshot of configured rest |
| actual_rest_seconds | integer nullable | real rest taken, including extensions |
| rest_extended | boolean NOT NULL default false | true if user asked for more rest time |
| recorded_at | timestamp NOT NULL default now() | |

### `daily_metrics` (wearable integration — see §5b)
One row per calendar day, upserted from wearable data (currently Whoop via the totem MCP). Powers readiness-aware coaching ("recovery is 34% today — let's go lighter") and longer-term correlations.

| column | type | notes |
|---|---|---|
| id | serial PK | |
| metric_date | date NOT NULL UNIQUE | upsert key |
| recovery_score | integer nullable | 0-100 |
| hrv_ms | integer nullable | |
| resting_hr | integer nullable | |
| sleep_performance | integer nullable | 0-100 |
| sleep_duration_minutes | integer nullable | |
| day_strain | numeric nullable | Whoop strain (0-21) |
| source | text NOT NULL default 'whoop' | future: 'garmin', 'manual', ... |
| raw_json | text nullable | full payload snapshot for future reprocessing |
| recorded_at | timestamp NOT NULL default now() | |

### `workout_history` — additional columns for wearable data
| column | type | notes |
|---|---|---|
| avg_heartrate | integer nullable | from wearable, attached post-session |
| max_heartrate | integer nullable | |
| workout_strain | numeric nullable | Whoop per-activity strain |
| calories | integer nullable | |
| external_activity_id | text nullable | wearable's workout id, for dedup |
| metrics_source | text nullable | 'whoop', 'manual', ... |

### `workout_templates`
| column | type | notes |
|---|---|---|
| id | serial PK | |
| name | text NOT NULL | |
| exercises_json | text NOT NULL | snapshot of exercise list for this template |
| is_active | boolean NOT NULL default false | |
| created_at | timestamp | |

---

## 5. MCP Tools

### Workout flow (conversational — Claude paces the conversation, server just records state)
| Tool | Input | Output / Effect |
|---|---|---|
| `get_todays_exercises` | — | ordered list of configured exercises |
| `start_workout` | — | creates `workout_history` row, returns its id |
| `start_exercise` | `exerciseId` | records `started_at`; returns planned duration + this exercise's last-session log (for "last time..." callouts) |
| `end_exercise` | `exerciseId`, `endedEarly`, `actualDurationSeconds` | records actual duration + early-stop flag |
| `log_feedback` | `exerciseId`, `repsText?`, `feedbackText?` | saves reported reps/comments |
| `start_rest` | `exerciseId`, `plannedRestSeconds` | marks rest start |
| `check_time` | `exerciseId` | authoritative timing from server clock: `serverTime`, `elapsedSeconds`, `remainingSeconds` vs planned duration (or vs planned rest, if currently resting). Claude has no internal clock — this is how "how long left?" gets an accurate answer. Limitation: Claude only reads time when the user sends a message; it cannot self-fire when a timer expires. |
| `end_rest` | `exerciseId`, `actualRestSeconds`, `restExtended` | records actual rest behavior, finalizes the `exercise_logs` row |
| `complete_workout` | `workoutHistoryId`, `exercisesCompleted` | marks `completed_at`, tallies count |
| `save_workout_note` | `workoutHistoryId`, `notes` | attaches a note to a session |

### Progress & motivation
| Tool | Input | Output |
|---|---|---|
| `get_streak` | — | current consecutive-day streak |
| `get_progress_summary` | `exerciseId` | last 7 sessions' reps/duration/rest for that exercise, for progressive-overload suggestions |
| `get_history` | `limit?` | recent workouts with nested exercise logs |

### 5b. Wearable & health metrics (Apple Health, totem/Whoop, manual)

**Integration pattern — Claude is the sync layer.** WorkoutGuide never talks to any health platform directly. Claude reads from whatever source is available in the current session and writes the durable subset into WorkoutGuide with the tools below. Sources, in priority order:

| Source | How Claude reads it | Provides | Notes |
|---|---|---|---|
| **Apple Health** (`source: 'apple_health'`) — **primary** | Claude iOS app's native Apple Health integration (beta, Pro/Max, US, read-only) | workouts (type/duration/HR/calories), HRV, resting HR, sleep, activity | Official & ToS-clean. **iPhone-app only** — web/desktop sessions can't read it, but they read the persisted `daily_metrics` rows, which is exactly why we persist. No recovery score (Whoop-proprietary) — readiness rules in §6a use HRV/RHR baselines instead, so nothing breaks. |
| **totem/Whoop** (`source: 'whoop'`) — optional enrichment | totem MCP tools (`whoop_recovery`, `whoop_sleep`, ...) | adds recovery score + strain on top of the above | Best-effort only: private iOS API (ToS risk, ~30-day tokens). Never a dependency. |
| **Manual** (`source: 'manual'`) — fallback | user states numbers conversationally | whatever they say | "Recovery's 55, slept 6 hours" → logged as-is |

**Dedup & priority:** the same workout/day can arrive from multiple sources (Whoop syncs into Apple Health). Rules: dedup workouts on `externalActivityId` + start-time window; for `daily_metrics`, upsert per-field with the richer source winning per field (e.g. Apple Health HRV + Whoop recovery score coexist in one row; record the winning source per write in `source`, keep the latest full payload in `raw_json`).

| Tool | Input | Output / Effect |
|---|---|---|
| `log_daily_metrics` | `date`, `recoveryScore?`, `hrvMs?`, `restingHr?`, `sleepPerformance?`, `sleepDurationMinutes?`, `dayStrain?`, `source?`, `rawJson?` | upserts `daily_metrics` row by date (per-field merge per priority rules above) |
| `get_daily_metrics` | `date?` (default today), or `fromDate`+`toDate` | one day or a range, for readiness checks and trend callouts |
| `attach_workout_metrics` | `workoutHistoryId`, `avgHeartrate?`, `maxHeartrate?`, `workoutStrain?`, `calories?`, `externalActivityId?`, `source?` | enriches a completed session with wearable data (idempotent via `externalActivityId`) |
| `get_readiness_context` | — | convenience read: today's metrics + 7-day averages + last workout's strain, one call for session openers |

**Skill-level flow (goes in `skills/workout-coach.md`):**
1. **Session open:** read whatever health source this session has (Apple Health on iPhone; totem if connected; else ask casually or skip) → `log_daily_metrics` → `get_readiness_context` to tailor the session ("HRV's above your baseline and you slept 8h — good day to push")
2. **Readiness-aware adjustments:** per §6a rules (HRV vs 7-day baseline, RHR elevation, recovery <40% if available) → propose lighter/heavier; Claude proposes, user decides
3. **Post-workout:** after `complete_workout`, pull the matching activity (Apple Health workout or Whoop activity) and `attach_workout_metrics` (match by time window, dedup on `externalActivityId`)
4. **Degrade gracefully:** no health source available → coach without it, never block a workout. **Manual fallback:** the user can state metrics conversationally ("recovery's 55 today, slept 6 hours") and Claude logs them via `log_daily_metrics` with `source: 'manual'`.

### Config management (replaces the old Config page entirely)
| Tool | Input | Output |
|---|---|---|
| `list_exercises` | — | full exercise list |
| `add_exercise` | exercise fields | creates one |
| `update_exercise` | `id`, partial fields | updates one (name, durations, voice lines, image, sort order) |
| `delete_exercise` | `id` | removes one |
| `reorder_exercises` | `[{id, sortOrder}]` | bulk reorder |
| `list_templates` | — | all saved templates |
| `get_settings` | — | all runtime preferences from `app_settings` |
| `set_setting` | `key`, `value` | update a preference conversationally ("set my default rest to 40s") — no redeploy needed. Allowed keys validated by zod (e.g. `default_rest_seconds`, `default_duration_seconds`, `units`, `coaching_intensity`) |
| `save_template` | `name` | snapshots current exercise list as a named template |
| `switch_template` | `id` | replaces current exercise list with the template's snapshot |
| `delete_template` | `id` | removes a template |

### Export / Import — one-shot config & history transfer
| Tool | Input | Output |
|---|---|---|
| `export_backup` | — | **full personal backup**: exercises (incl. images/voice lines) + templates + complete history/logs + `daily_metrics` and wearable columns (incl. `raw_json`), as one JSON object |
| `export_shareable_config` | `includeVoiceLines?` (default false) | **routine only**, safe to hand to someone else: exercises (name/durations/order) + templates — no history, no logs, no images, no wearable data; voice lines stripped unless flag set |
| `import_backup` | JSON blob | **replace-only**: wipes existing data and restores everything, including history (for migration/recovery). Requires an explicit confirmation step before executing. |
| `import_shareable_config` | JSON blob | previews what will be added ("this will add 5 exercises: ..."), then upserts exercises/templates only — always additive/merge, no personal data touched |

**Export JSON shape (`export_backup`):**
```json
{
  "version": 1,
  "exportedAt": "2026-07-04T00:00:00.000Z",
  "exercises": [
    { "name": "Push-ups", "durationSeconds": 30, "restAfterSeconds": 25, "sortOrder": 0,
      "voiceStart": null, "voiceEnd": null, "imageData": null }
  ],
  "templates": [
    { "name": "Upper Body", "exercisesJson": "[...]", "isActive": true }
  ],
  "history": [
    { "startedAt": "...", "completedAt": "...", "notes": null,
      "logs": [ { "exerciseId": 1, "repsText": "12", "feedbackText": null,
        "plannedDurationSeconds": 30, "actualDurationSeconds": 28, "endedEarly": false,
        "plannedRestSeconds": 25, "actualRestSeconds": 25, "restExtended": false } ] }
  ]
}
```

`export_shareable_config` returns the same shape minus `history` and `imageData` (and optionally `voiceStart`/`voiceEnd`, if those feel too personal to share — **open question, see §8**).

**Viewing locally:** since there's no custom UI, the exported JSON is returned by Claude as a plain text/file artifact in the conversation — readable, saveable, and inspectable in any text editor before importing elsewhere. No custom viewer needed.

---

## 6. Configuration & Auth

### Configuration: two layers

**Layer 1 — boot config (secrets + infra): environment variables only.** Never a config file on the prod host. The repo is the source of truth (GitHub sync), so hand-edited files on Replit are fragile — overwritten on redeploy, and one `git add` away from leaking.

- **Production:** values live in **Replit Secrets** (encrypted, injected as env vars at boot, survive redeploys, rotatable from the Replit UI). There is **no `.env` file in production**.
- **Local dev:** a gitignored `.env` file in the repo working copy (your machine only), loaded via dotenv. Same variable names as Replit Secrets, so dev and prod can't drift.
- **Committed:** a `.env.example` documenting every variable, with placeholder values.

```bash
# .env.example  (committed — placeholders only, real values go in .env locally / Replit Secrets in prod)
DATABASE_URL=postgresql://user:pass@host:5432/workoutguide
MCP_AUTH_TOKEN=generate-with--openssl-rand-hex-32
MCP_PATH_SECRET=generate-with--openssl-rand-hex-32   # secret URL path segment, see Auth below
PORT=3000
LOG_LEVEL=info
```

```ts
// apps/mcp-server/src/config.ts — single source of boot config, validated at startup
import { z } from 'zod';
import 'dotenv/config';                      // no-op in prod (no .env file); loads .env locally

const ConfigSchema = z.object({
  DATABASE_URL: z.string().url(),
  MCP_AUTH_TOKEN: z.string().min(32),        // bearer token for header-capable clients
  MCP_PATH_SECRET: z.string().min(32),       // server mounts at /mcp/${MCP_PATH_SECRET}
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(['debug','info','warn','error']).default('info'),
});

const parsed = ConfigSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid configuration:\n', parsed.error.flatten().fieldErrors);
  process.exit(1);                           // crash loudly at boot, never run misconfigured
}
export const config = parsed.data;
```

**Layer 2 — runtime preferences (non-secret, user-changeable): stored in the database, managed via MCP tools.** Things like default rest/duration, units, coaching intensity shouldn't require a redeploy to change — you change them by talking to Claude.

#### `app_settings` (add to §4 schema)
| column | type | notes |
|---|---|---|
| key | text PK | e.g. `default_rest_seconds`, `units`, `coaching_intensity` |
| value | text NOT NULL | stored as text, parsed per-key by zod |
| updated_at | timestamp | |

Exposed via `get_settings` / `set_setting` tools (§5). Allowed keys and value shapes are whitelisted in `packages/shared` zod schemas — the tool rejects unknown keys, so conversational config stays safe.

### Auth: layered, because Claude clients differ

Key constraint: **Claude Code / API clients can send a custom `Authorization` header, but the claude.ai web & mobile connector UI (needed for phone access) can't — it expects OAuth or an open URL.** So:

| Layer | Mechanism | Covers |
|---|---|---|
| 1 (MVP) | **Secret URL path**: mount MCP at `/mcp/<random-64-hex>` instead of `/mcp` | All clients incl. phone. Effectively a token-in-URL; fine for a personal single-user server. Rotate by changing the secret. |
| 2 | **Bearer token middleware**: require `Authorization: Bearer $MCP_AUTH_TOKEN` | Claude Code, scripts, any header-capable client. Enable alongside layer 1. |
| 3 (later, if needed) | **OAuth 2.1 + dynamic client registration** (what claude.ai connectors natively expect; the MCP TypeScript SDK ships auth helpers, and totem's connector-password approach is a working reference) | Proper auth on phone/web without secret URLs |

**Recommendation:** ship with layers 1+2 (an hour of work, no OAuth complexity), revisit layer 3 only if the secret-URL approach ever feels insufficient. Additional hardening regardless of layer: HTTPS only (Replit provides), no request logging of the URL path, rate limiting, and DB on an internal connection (Neon/Supabase with TLS).

### Rotation & recovery

- Rotate `MCP_AUTH_TOKEN` / URL secret from Replit Secrets UI → redeploy → update the connector URL in Claude clients.
- Since `export_backup` exists, worst-case recovery from a compromised host is: rotate secrets, wipe DB, `import_backup`.

---

## 6a. The coaching Skill (`skills/workout-coach.md`)

A plain-English Skill file (not code) that governs how Claude behaves when using these tools. Structure it like a proper skill (frontmatter description → workflow phases → key principles → critical reminders), not just a topic list:

**Tone:** energetic, motivating, references past performance, celebrates PRs. Guiding principle: **consistency over heroics** — showing up beats occasional big efforts, and the streak is the product.

**Workflow phases:**
1. **Session open:** greet, check streak (`get_streak`), pull readiness (`get_readiness_context`, after syncing from totem per §5b), build energy, confirm ready
2. **Per-exercise flow:** announce exercise (`start_exercise` returns last-session log for "last time..." callouts) → confirm readiness → pace conversationally, using `check_time` for precise elapsed/remaining when asked → ask how it felt / reps → `log_feedback` → rest (`start_rest`/`end_rest`), offering extensions freely → next
3. **Session close:** `complete_workout`, summarize vs. last time, celebrate, offer to save a note

**Readiness interpretation (from `daily_metrics`):** judge HRV against the athlete's own 7-day rolling average, not single-day swings; resting HR elevated 5-10+ bpm over baseline = accumulated fatigue → propose a lighter session; recovery <40% → propose reduced durations or extra rest. A sudden RHR drop below baseline can signal illness onset — mention it gently, don't diagnose.

**Progressive overload:** call `get_progress_summary` when opening an exercise the user has history on. Suggest small increments ("last time 12 — aim for 13-14 today"), never big jumps. If the last 2 sessions show declining reps or repeated early stops, propose backing off, not pushing.

**Critical reminders (skill's non-negotiables):**
- **Claude proposes, the user decides** — never silently change durations, rest, or targets; suggest and confirm
- Never block a workout on wearable data — if totem is down, coach without it
- Log everything the user reports, even mid-set comments ("shoulder tight" → `log_feedback` immediately)
- Streak milestones get celebrated; broken streaks get zero guilt — restart framing only

This file is the "personality" layer — editable in plain English, independent of the tool/data layer, and portable to any Claude client.

---

## 7. What's explicitly out of scope (removed from the original prototype)

- Web frontend (React/Vite/Tailwind/dnd-kit) — deleted entirely
- Separate REST API (`apps/server`) — folded into the MCP server
- In-app TTS/speech synthesis — Claude speaks/writes naturally, no code needed
- In-app STT/speech recognition — Claude's own voice/text input handles this
- "Hey Workout" wake word — not needed; you just talk to Claude
- Web Audio metronome — dropped. **Timing is handled server-side instead:** `start_exercise`/`start_rest` record timestamps and the `check_time` tool (§5) returns authoritative elapsed/remaining from the server clock whenever asked. Claude paces conversationally and answers "how long left?" precisely; it cannot self-fire at zero (it only reads the clock when the user sends a message).
- Canvas-based shareable image card — could be revisited later as a nice-to-have, not core

---

## 8. Open questions — **all resolved (v0.4)**

1. **Voice lines in shareable export:** ~~resolved~~ — **stripped by default**; `export_shareable_config` accepts an optional `includeVoiceLines: true` flag.
2. **Single vs. combined export tools:** ~~resolved~~ — **two distinct tools** (`export_backup`, `export_shareable_config`); clearer intent, avoids accidental oversharing.
3. **Hosting:** ~~resolved~~ — **Replit** (paid always-on tier, existing credits), deployed via GitHub sync; repo remains the source of truth, never edit directly on Replit. Postgres: default to **Replit's built-in Postgres** (managed, covered by credits, zero extra accounts); revisit an external managed Postgres (Neon/Supabase) only if backup/branching needs outgrow it. Deployment ops (secrets, redeploys, logs) are managed through the Replit UI — Replit's official MCP is Agent-centric ("prompt → app") and not suited to granular deploy management, and community Replit MCPs require handing over a session cookie, which we won't do. Day-to-day flow: edit repo locally (Claude Code) → push to GitHub → Replit auto-deploys.
4. **Import safety:** ~~resolved~~ — `import_backup` is **replace-only** (wipe and restore; it exists for full recovery). `import_shareable_config` remains additive/merge with a preview step.
5. **Auth on the MCP server:** ~~resolved~~ — see §6 (Configuration & Auth). Decision: Replit Secrets for config, secret URL path + bearer token for auth at launch, OAuth deferred.
6. **Wearable data in exports:** ~~resolved~~ — `daily_metrics` + `workout_history` wearable columns **including `raw_json`** go in `export_backup` (completeness over size); all of it **excluded** from `export_shareable_config`.
7. **Totem dependency risk:** ~~resolved~~ — integration stays strictly optional/best-effort, **and a `source: 'manual'` path is in scope**: the user can tell Claude their recovery/sleep numbers conversationally and Claude logs them via `log_daily_metrics` with `source: 'manual'`.

---

## 9. Migration notes from the prototype

**Data: fresh start — the prototype's database will NOT be migrated.** These notes are about porting *code and design*, not data.

- Postgres schema is additive-compatible — the existing `exercise_logs` fields (added in the voice-flow iteration) map directly to what this spec needs; no schema redesign required, just re-implementing access as MCP tools instead of REST routes + a React UI.
- The Drizzle query logic already written in the prototype's `apps/server/src/routes/*.ts` ports nearly line-for-line into tool handlers (same shape: validate input → query db → return data).
- `packages/shared`'s zod schemas remain the source of truth for data shapes and can be reused as-is for tool input/output validation.
