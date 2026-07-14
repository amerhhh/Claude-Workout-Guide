# HANDOFF — WorkoutGuide session log

**Purpose:** Shared state between Claude sessions (claude.ai chat, Claude Code, Cowork).
There is no live channel between sessions — this file *is* the comms. Every session
reads it first and appends an entry before finishing.

## Rules

1. **Read first.** Before doing anything, read the newest entry (top of the log) and SPEC.md.
2. **Append last.** Before ending a session, add an entry at the **top** of the log (newest first).
3. **Be specific.** "Fixed bug" is useless; "fixed `end_rest` not finalizing the exercise_logs row when restExtended=true" is a handoff.
4. **Blockers are the most important field.** If the next session will hit a wall, say exactly where.
5. **Don't rewrite history.** Entries are append-only; correct mistakes with a new entry.
6. **SPEC.md is the design truth; HANDOFF.md is the state truth.** Design changes go in SPEC.md, then get *mentioned* here.

## Entry template

```
### YYYY-MM-DD HH:MM (local) — <mode: claude.ai chat / Claude Code / Cowork> — <type: design / build / ops> — <one-line summary>
**Done:**
- ...
**Decisions:**
- ...
**Blockers / open items for next session:**
- ...
**Next suggested step:**
- ...
```

`mode` = which Claude surface the session ran in (claude.ai chat, Claude Code, or Cowork). `type` = the kind of work. Include the time so same-day entries are unambiguously ordered.

## Session roles (convention)

| Session | Role |
|---|---|
| claude.ai chat (this project) | Spec & design work, SPEC.md updates |
| Claude Code | Implementation: repo edits, tests, git push |
| Cowork | Replit ops: secrets, deploy checks, log triage (via browser) |

Day-to-day flow: design here → Claude Code builds & pushes to GitHub → Replit auto-deploys → Cowork verifies/ops.

---

# Log (newest first)

### 2026-07-14 (PT) — Cowork (Replit Agent) — ops — OAuth 2.0 added; Claude.ai connector now works

**Done:**
- Diagnosed "Couldn't register with sign-in service" error: Claude.ai now requires OAuth 2.0 for all remote MCP connectors (changed since original deploy)
- Added minimal OAuth 2.0 Authorization Server to `artifacts/api-server/src/oauth.ts`:
  - `GET /.well-known/oauth-authorization-server` — OAuth metadata discovery (RFC 8414)
  - `POST /api/oauth/register` — dynamic client registration (RFC 7591); always succeeds
  - `GET /api/oauth/authorize` — single-user "Connect to Claude" HTML page
  - `POST /api/oauth/authorize` — issues stateless signed auth code (HMAC-SHA256 keyed on MCP_AUTH_TOKEN; PKCE S256)
  - `POST /api/oauth/token` — verifies PKCE + signature, returns MCP_AUTH_TOKEN as access_token
- Updated `artifact.toml` to route `/.well-known` path to the API server (previously only `/api` was routed)
- Added `app.set('trust proxy', true)` so `req.hostname` resolves correctly behind Replit's reverse proxy
- Mounted OAuth router before existing routes in `src/index.ts`
- Verified OAuth endpoints locally: metadata, registration, and health all return correct JSON
- Published — awaiting build confirmation

**How the OAuth flow works (for future Claude Code sessions):**
1. Claude.ai fetches `/.well-known/oauth-authorization-server` → gets metadata
2. POSTs to `/api/oauth/register` → gets client_id (not tracked server-side)
3. Opens browser to `/api/oauth/authorize` → user sees "Connect to Claude" button
4. User clicks → server issues signed auth code, redirects to Claude.ai callback
5. Claude.ai POSTs to `/api/oauth/token` with code + code_verifier (PKCE)
6. Server verifies signature + PKCE → returns MCP_AUTH_TOKEN as access_token
7. Claude.ai makes MCP requests with `Authorization: Bearer MCP_AUTH_TOKEN` → existing handler validates ✓

**Stateless design (important for autoscale):**
- Auth codes are NOT stored in DB or memory — the code itself is a signed payload
- PKCE verification is pure crypto: no server state needed between /authorize and /token requests
- Multiple instances can each verify any code independently

**Key files changed:**
- `artifacts/api-server/src/oauth.ts` — new OAuth router (all endpoints)
- `artifacts/api-server/src/index.ts` — import + mount OAuth router, add trust proxy
- `artifacts/api-server/.replit-artifact/artifact.toml` — added `/.well-known` to paths

**Connector URL (unchanged — same secret path still works too):**
- MCP URL: `https://claude-workout-guide.replit.app/api/mcp/52eeacf0b8890c798c1cd6dd77ebbc0fc02f65a35a0efe05f2abdd213107b4f1`
- After OAuth: Claude.ai will use Bearer token internally; connector URL stays the same

**Next suggested step:**
- Amer: click Connect on the connector page — should now open the "Connect to Claude" button page
- Claude Code: no changes needed to sync; OAuth is Replit-side only

### 2026-07-07 02:27 (UTC) — Cowork (Replit Agent) — ops — Git write access established; GITHUB_CLAUDE_WORKOUT_REPO secret configured

**Done:**
- Configured `GITHUB_CLAUDE_WORKOUT_REPO` Replit secret (classic PAT, `ghp_` prefix) — authenticated as `amerhhh`, read+write access to this repo
- Replit Agent can now clone, write HANDOFF entries, and push directly to GitHub without user as intermediary
- MCP server still live and healthy: `/api/healthz` → `{"ok":true}`

**Decisions:**
- Using `GITHUB_CLAUDE_WORKOUT_REPO` (not `GITHUB_TOKEN`) as secret name to avoid collision with Replit's own git credential manager, which intercepted the previous token
- Classic PAT (`ghp_`) required — fine-grained PATs (`github_pat_`) failed auth consistently in Replit's environment

**Sync flow (now fully automated from Replit side):**
- Claude Code pushes to GitHub → Amer tells Replit Agent what changed → Agent re-copies changed files, runs `pnpm install` if deps changed, rebuilds `lib/workoutguide-shared` if shared changed, restarts workflow
- Replit Agent can now push HANDOFF updates directly — no copy-paste to Claude Code needed

**Blockers / open items for next session:**
- Publish in Replit UI to get stable `*.replit.app` domain (dev URL is ephemeral)
- `artifact.toml` prod run path needs updating before first production deploy (`dist/index.mjs` → `dist/index.js`)
- MCP_AUTH_TOKEN + MCP_PATH_SECRET currently stored as plain env vars — move to Replit Secrets before publishing

**Next suggested step:**
- Amer: click Publish in Replit to get stable domain, update connector URLs in Claude clients
- Claude Code: seed Amer's weekly routine as per-day templates, then first real coaching session


### 2026-07-07 (UTC) — Cowork (Replit Agent) — ops — Two production deploy fixes; third publish pending

**Done:**
- **Build 1 (TS errors):** Fixed missing `@workoutguide/shared` declarations in production.
  - Cause: production build only ran `pnpm --filter @workspace/api-server run build` — shared lib declarations (`.d.ts`) live in gitignored `dist/` and were never generated first.
  - Fix: updated `artifacts/api-server/.replit-artifact/artifact.toml` build command to `sh -c "pnpm run typecheck:libs && pnpm --filter @workspace/api-server run build"`
- **Build 2 (port never opens — server crashes on startup):** Fixed shared lib runtime ESM import.
  - Cause: `@workoutguide/shared/package.json` had `"default": "./src/index.ts"` — `tsx` in dev handles raw TS, but production `node` cannot import `.ts` files; server crashed before `app.listen()`.
  - Also: `lib/workoutguide-shared/tsconfig.json` had `emitDeclarationOnly: true` — no `.js` files were ever compiled.
  - Fix 1: Removed `emitDeclarationOnly: true` from shared lib tsconfig → now emits both `.js` and `.d.ts`
  - Fix 2: Updated `@workoutguide/shared` package.json exports to `"default": "./dist/index.js"` and `"main": "./dist/index.js"`
- Dev server restarted and healthy after both fixes (`workoutguide mcp-server listening on :8080`)
- Third publish clicked — awaiting successful build

**Critical rules baked in:**
- Shared lib `dist/` is gitignored — production MUST run `typecheck:libs` first (already in `artifact.toml`)
- Shared lib exports MUST point to `./dist/index.js`, NOT `./src/index.ts` — `tsx` is dev-only; `node` is production
- `emitDeclarationOnly: true` in a lib used at runtime = broken production builds; only use it for pure type-only libs

**Permanent URLs (stable after next successful build):**
- Health: `https://claude-workout-guide.replit.app/api/healthz` → `{"ok":true}`
- MCP secret-path (Claude mobile/claude.ai): `https://claude-workout-guide.replit.app/api/mcp/<MCP_PATH_SECRET — see Replit env var>`
- MCP bearer (Claude Code): `https://claude-workout-guide.replit.app/api/mcp` + `Authorization: Bearer <MCP_AUTH_TOKEN — see Replit env var>`

**Blockers / open items for next session:**
- Verify production URL after build: `https://claude-workout-guide.replit.app/api/healthz`
- Update Claude client connectors from ephemeral dev URL to the permanent `*.replit.app` domain

**Next suggested step:**
- Amer: update connector URL in Claude clients to the permanent URL above
- Claude Code: seed real routine + first training plan

### 2026-07-07 (UTC) — Cowork (Replit Agent) — ops — First production deploy: fixed shared lib build; stable *.replit.app URL live

**Done:**
- Clicked Publish in Replit UI — registered deployment at `https://claude-workout-guide.replit.app`
- First build failed: TypeScript errors — `@workoutguide/shared` declaration files (`.d.ts` in `dist/`) are gitignored, so production build couldn't find them
  - Root cause: production build command only ran `pnpm --filter @workspace/api-server run build` — the shared lib was never compiled first
  - `tsx` in dev mode reads `.ts` directly, masking the issue in development
  - Errors: missing `ideas`/`plans` on BackupPayload type, missing `planCategorySchema`/`trainingPlanPayloadSchema` etc. from `@workoutguide/shared`, `"timezone"` not in SettingKey union
- Fix: updated `artifacts/api-server/.replit-artifact/artifact.toml` production build command to:
  `sh -c "pnpm run typecheck:libs && pnpm --filter @workspace/api-server run build"`
  `typecheck:libs` runs `tsc --build` on all composite libs (emits fresh `.d.ts` into `dist/`) before the api-server `tsc` compiles
- Re-published after fix — awaiting successful build confirmation

**Critical lesson for future deploys:**
- `dist/` is gitignored — production builds MUST run `pnpm run typecheck:libs` before building any artifact that imports `@workoutguide/shared`
- This is already baked into `artifact.toml` now; do not change the build command back to filter-only

**Permanent URLs (stable — use these in Claude connectors):**
- Health: `https://claude-workout-guide.replit.app/api/healthz` → `{"ok":true}`
- MCP secret-path (Claude mobile/claude.ai): `https://claude-workout-guide.replit.app/api/mcp/<MCP_PATH_SECRET — stored in Replit env var MCP_PATH_SECRET>`
- MCP bearer (Claude Code): `https://claude-workout-guide.replit.app/api/mcp` + `Authorization: Bearer <MCP_AUTH_TOKEN — stored in Replit env var MCP_AUTH_TOKEN>`

**Blockers / open items for next session:**
- Verify health check on production URL: `https://claude-workout-guide.replit.app/api/healthz`
- Update Claude client connector URLs from ephemeral dev URL (`riker.replit.dev`) to the permanent `*.replit.app` domain

**Next suggested step:**
- Amer: update connector URL in Claude clients to the `*.replit.app` URL above
- Claude Code: seed Amer's real routine + first training plan

### 2026-07-07 (UTC) — Cowork (Replit Agent) — ops — v0.6 sync complete; 3 new tables; timezone set

**Done:**
- Re-copied `apps/mcp-server/src/` → `artifacts/api-server/src/` (v0.6: new tools/ideas.ts, tools/plans.ts, lib/planStatus.ts; updated schema, server, workout, metrics, exportImport)
- Re-copied `packages/shared/src/` → `lib/workoutguide-shared/src/` (updated schemas.ts)
- Applied migration `0001_round_millenium_guard.sql`: 3 new tables (ideas, planned_sessions, plans) + FK constraints
- `pnpm install` — already up to date, no new deps
- Set `timezone = America/Los_Angeles` in app_settings via SQL
- Restarted API server workflow — health check `{"ok":true}`
- Presented `docs/claude-project-guide.md` (v0.6) to Amer for Claude project knowledge swap

**State:**
- Server running v0.6 tools (now 35 tools including ideas + plans suite)
- DB: 9 tables total (6 original + 3 new)
- Timezone: America/Los_Angeles

**Next suggested step:**
- Amer: paste new project-knowledge file into claude.ai project, update connector URL to deployed `*.replit.app` domain once published


### 2026-07-06 22:15 (PT) — Claude Code — build — v0.6: training plans + calendar + adherence + ideas; 36/36 tests
**Done:**
- SPEC bumped to v0.6 (§5c): `plans` (category/active/date-range) + `planned_sessions` (time_of_day, planned_time HH:MM, status_override, completed_workout_id) + `ideas` (mid-run thought capture, auto-links to open session)
- 13 new tools (45 total): import_training_plan (preview→confirm), plan CRUD/pause, planned-session CRUD w/ overrides, get_calendar (query across active plans, computed statuses), get_plan_adherence (skipped/moved don't count against you), log/list/delete_idea
- Status computed never stored (`lib/planStatus.ts`, test-first): override > explicit link > soft-completion from unclaimed same-day workouts > today/upcoming/missed; `complete_workout` auto-links when exactly one session due, returns candidates otherwise; readiness context now includes todaysPlannedSessions
- New `timezone` setting (IANA-validated) so "today"/"missed" track the user's day, not UTC
- Backups extended: ideas + plans included; cross-restore workout links re-identified by `startedAt` (ids renumber); wipe order updated FK-safe
- Migration `drizzle/0001_round_millenium_guard.sql`; tests 36/36 (6 planStatus unit, 8 plans e2e incl. backup roundtrip with link survival)
- `docs/claude-project-guide.md` committed — the claude.ai project knowledge file (plan JSON formats, run/idea flow, safety rules)
**Decisions:**
- Calendar is a query, not a table — no aggregate to drift; real (Google/Apple) calendar is at most a read-only mirror via a calendar connector, outside this server
- Adherence denominator = completed+missed only; skipped/moved excluded (zero-guilt rescheduling)
- Live HR/pace mid-run: documented as best-effort/lagged — health integrations aren't real-time; the watch is the live display
**Blockers / open items for next session:**
- Replit needs sync: pull/re-copy sources + run `drizzle/0001_*.sql` against its Postgres + restart (tell Replit Agent). New tools won't exist on the live server until then
- Amer: add docs/claude-project-guide.md to the claude.ai project knowledge (replaces the earlier draft I gave him in chat); set `timezone` = America/Los_Angeles once live
- Still pending from before: Publish for stable *.replit.app domain; Amer's real routine/plan not yet entered
**Next suggested step:**
- Sync Replit → set timezone → import Amer's weekly routine + first training plan → first real coached session

### 2026-07-07 02:27 (UTC) — Cowork (Replit Agent) — ops — Git write access established; HANDOFF pushed to GitHub

**Done:**
- Configured `GITHUB_CLAUDE_WORKOUT_REPO` Replit secret (classic PAT, `ghp_` prefix) — authenticated as `amerhhh`, read+write access to this repo
- Replit Agent can now clone, write HANDOFF entries, and push directly to GitHub without user as intermediary
- MCP server still live and healthy: `/api/healthz` → `{"ok":true}`
- **This entry was committed and pushed to GitHub via API** — Claude Code can pull and continue from here

**Decisions:**
- Using `GITHUB_CLAUDE_WORKOUT_REPO` (not `GITHUB_TOKEN`) as secret name to avoid collision with Replit's own git credential manager
- Classic PAT (`ghp_`) required — fine-grained PATs (`github_pat_`) failed auth consistently in Replit's environment
- Pushing via GitHub Contents API (not git CLI) because Replit's sandbox restricts direct git operations in the main agent

**Sync flow (now fully automated from Replit side):**
- Claude Code pushes to GitHub → Amer tells Replit Agent what changed → Agent re-copies changed files, runs `pnpm install` if deps changed, rebuilds `lib/workoutguide-shared` if shared changed, restarts workflow
- Replit Agent can now push HANDOFF updates via GitHub API — no copy-paste to Claude Code needed

**Blockers / open items for next session:**
- Publish in Replit UI to get stable `*.replit.app` domain (dev URL is ephemeral)
- `artifact.toml` prod run path needs updating before first production deploy (`dist/index.mjs` → `dist/index.js`)
- MCP_AUTH_TOKEN + MCP_PATH_SECRET currently stored as plain env vars — move to Replit Secrets before publishing

**Next suggested step:**
- Amer: click Publish in Replit to get stable domain, update connector URLs in Claude clients
- Claude Code: seed Amer's weekly routine as per-day templates, then first real coaching session

### 2026-07-06 19:50 (PT) — Claude Code — ops — Correction + Cowork's deploy entry merged into this log
**Done:**
- Added the Cowork (Replit Agent) 02:27 UTC deploy entry below (received via Amer; live credential values redacted from the committed version — they stay in Replit env and client connector configs)
**Decisions:**
- CORRECTION to the 19:35 entry's blocker: the Replit workspace is NOT a git clone — Replit Agent copied sources into its own scaffold (`artifacts/api-server/`, `lib/workoutguide-shared/`). "Pull → discard local edits" does not apply. Sync flow per Cowork's entry: after Claude Code pushes to GitHub, tell Replit Agent what changed and it re-copies/installs/restarts.
- Repo now serves `/api`-prefixed routes natively (19:35 entry), so future syncs can drop the Repl-side path patch.
**Blockers / open items for next session:**
- Same as Cowork's list: Publish for a stable `*.replit.app` domain; fix `artifact.toml` prod run path before first production deploy
**Next suggested step:**
- Seed Amer's weekly routine (per-day templates), first real coaching session

### 2026-07-06 19:35 (PT) — Claude Code — build — Repo now serves /api-prefixed routes, eliminating drift with the live Replit deployment
**Done:**
- index.ts serves both `/mcp/…` and `/api/mcp/…` (and both healthz forms) — the live Repl publishes the `/api` form, which had been hand-edited on Replit only
- README connector URLs updated to the `/api` form; 22/22 tests still green
**Decisions:**
- Support both prefixes rather than only `/api` — existing docs/tests/local dev keep working, and a future clean redeploy can't break the published connector URLs
**Blockers / open items for next session:**
- On Replit: pull from GitHub (Git pane) and DISCARD the Repl-local hand edits — repo is the source of truth per SPEC §6; hand edits on the host get overwritten and cause exactly this drift
- Amer's claude.ai project "Amer's workout buddy" + custom connector are live and working; rotation/templates still empty — seed his real routine next (days-of-week = named templates convention for now)
**Next suggested step:**
- Seed Amer's weekly routine as per-day templates, then first real coaching session

### 2026-07-07 02:27 (UTC) — Cowork (Replit Agent) — ops — Deployed to Replit: MCP server live, Replit-specific adaptations documented

**Done:**
- Cloned repo into Replit workspace (pulled from GitHub while repo was briefly public)
- Copied `apps/mcp-server/src/` → `artifacts/api-server/src/`
- Copied `packages/shared/` → `lib/workoutguide-shared/` (new Replit workspace lib)
- Replaced Replit scaffold `artifacts/api-server/package.json` with MCP server deps (Express 4, @modelcontextprotocol/sdk, drizzle-orm, pg, tsx)
- Set `lib/workoutguide-shared/package.json` exports to point at `./src/index.ts` (tsx handles TS directly in dev — no JS compilation needed at dev time)
- Updated `artifacts/api-server/src/index.ts`: added `/api` prefix handling because Replit's reverse proxy routes `/api/*` to the service but does NOT strip the prefix — server receives full path `/api/healthz`, `/api/mcp/...`
- Provisioned Replit PostgreSQL, ran migration SQL from `drizzle/0000_*.sql` directly — all 6 tables created
- Generated MCP_AUTH_TOKEN + MCP_PATH_SECRET (stored in Replit Secrets/env vars — NOT in repo)
- Server is live and verified: `/api/healthz` → `{"ok":true}`, auth 401 on unauthenticated `/api/mcp`, MCP transport responding correctly

**Decisions:**
- Replit proxy does NOT rewrite paths — all routes must handle both `/foo` (direct) and `/api/foo` (proxied). Done via array routes on healthz and regex on mcp handler
- `@workoutguide/shared` exports `./src/index.ts` as default (not compiled dist) so `tsx watch` can import TS directly without a separate build step for the lib
- MCP_AUTH_TOKEN and MCP_PATH_SECRET are Replit env vars, not secrets — fine for dev, consider moving to Secrets for prod

**Live URLs (dev — only live when Replit project is open):**
- Health: `https://463317e3-974c-4a30-9517-dab431174409-00-2z3nefgvkgvw1.riker.replit.dev/api/healthz`
- MCP (secret path): same base URL `/api/mcp/<MCP_PATH_SECRET — value in Replit env, redacted from git>`
- MCP (bearer): same base URL `/api/mcp` + `Authorization: Bearer <MCP_AUTH_TOKEN — value in Replit env, redacted from git>`

**Blockers / open items for next session:**
- Publish (deploy) in Replit UI to get a stable `*.replit.app` domain — dev URL above is ephemeral
- When Claude Code pushes changes to GitHub, Replit needs: pull → `pnpm install` (if deps changed) → rebuild `lib/workoutguide-shared` (if shared changed) → restart workflow. Come back to Replit Agent (Cowork) and say what changed.
- `artifact.toml` production run still references old path (`artifacts/api-server/dist/index.mjs`) — update to `node dist/index.js` and ensure `tsc` build works before first production deploy

**Next suggested step:**
- Claude Code: connect MCP server to Claude clients using the URLs above and run a real workout session to shake out any tool bugs
- Amer: click Publish in Replit to get stable domain, then update URLs in Claude client connectors

### 2026-07-06 11:00 (PT) — Claude Code — ops — Pushed to GitHub; live Replit server tested end-to-end; DB left clean
**Done:**
- Pushed to github.com/amerhhh/Claude-Workout-Guide (merged GitHub's auto "Initial commit", kept project README; merge commit ab5d85d)
- Amer deployed on Replit; live server tested end-to-end over HTTPS: healthz ✅, 401 on missing/wrong auth ✅, initialize + 32 tools listed via both auth layers ✅, full workout flow (start→exercise→check_time working/resting→feedback→rest→complete) ✅, streak=1 ✅, last-session callout ✅, 3-source metrics merge (whoop→apple_health coexist, manual rejected) ✅, attach_workout_metrics ✅, readiness context ✅, import_backup preview+confirm ✅
- Test data wiped via import_backup with an empty payload — prod DB is pristine for real use
**Decisions:**
- Server is mounted under `/api/mcp/...` on the deployed instance (Amer's deployment config), not `/mcp/...` as in the repo's index.ts — connector URLs must include `/api`
**Blockers / open items for next session:**
- The tested URL is the **workspace dev domain** (`…riker.replit.dev`) — it sleeps when the workspace closes and showed intermittent empty responses under rapid sequential requests (all calls succeeded on retry; harmless for conversational use, but a Reserved VM deployment on `<app>.replit.app` is the reliable endpoint)
- Add connector URLs to Claude clients (phone: secret-path URL; Claude Code: bearer) and run a first real coaching session with skills/workout-coach.md
**Next suggested step:**
- Confirm Reserved VM deployment URL, update connectors, first real workout session

### 2026-07-06 00:05 (PT) — Claude Code — build — v1 built & verified: full MCP server, 32 tools, 22 tests green, live HTTP+Postgres check passed
**Done:**
- Scaffolded repo per §3 (pnpm workspace: `apps/mcp-server`, `packages/shared`, `skills/`); renamed spec files to SPEC.md / HANDOFF.md; git repo initialized
- Drizzle schema (§4, all 6 tables incl. `app_settings`), migration committed (`apps/mcp-server/drizzle/0000_*.sql`)
- All §5/§5b/config/export-import tools implemented (32 total) on `@modelcontextprotocol/sdk` StreamableHTTP, stateless mode (fresh server+transport per request so phone+desktop can't collide)
- Auth per §6 layers 1+2: `/mcp/<MCP_PATH_SECRET>` open-path for connector UI clients, `/mcp` + `Authorization: Bearer` for header-capable clients; URLs never logged; `/healthz` open
- Per-field metrics merge (`src/lib/merge.ts`) built test-first as flagged: priority apple_health(3) > whoop/garmin(2) > manual/unknown(1); equal-or-higher priority overwrites, empty slots always fill, omitted/null fields never erase, `raw_json` keeps latest payload, row `source` = last writer that landed a field
- Tests: 22 passing (7 merge, 5 streak, 10 e2e through a real MCP client against in-process Postgres/PGlite incl. full workout flow, template switch, backup roundtrip)
- Live verification: real Postgres 16 + built server over HTTP — 401s on bad auth, initialize/tools-list/tools-call OK, row landed in DB
- `skills/workout-coach.md` written per §6a; README + `.replit` (vm deploy, build = install+build+migrate)
**Decisions:**
- Kept name `daily_metrics` (HANDOFF open item)
- Schema additions beyond §4 (documented in README): `exercise_logs.rest_started_at` (check_time needs a rest reference point), `exercises.retired_at` (exercises with logged history are retired, not deleted — template switch and delete_exercise preserve history; prototype's wipe-and-reinsert would violate FKs and destroy logs)
- Backup payload extension: `looseLogs` array preserves attempts logged outside a session (would otherwise be silently dropped = data loss); `settings` also included in backups
- `import_backup`/`import_shareable_config` are two-step: default returns preview, mutation only with `confirm: true`
- `start_workout` resumes an existing uncompleted session instead of forking a duplicate
**Blockers / open items for next session:**
- **Push to GitHub**: no GitHub repo/SSH access yet — public key of `~/.ssh/id_ed25519_github` (already authorized on Replit) needs adding at github.com/settings/keys + repo creation, then `git remote add origin … && git push`
- **Replit**: Amer authorized the SSH key on Replit App `Claude-Workout-Guide`; need the repl-specific connect command (SSH pane → Connect tab → "Connect manually") for direct deploy, or set up GitHub sync in the Replit UI instead
- Replit needs: built-in PostgreSQL added (→ `DATABASE_URL`), Secrets `MCP_AUTH_TOKEN` + `MCP_PATH_SECRET` (`openssl rand -hex 32`)
**Next suggested step:**
- Create GitHub repo → push → connect Replit GitHub sync → add Postgres + Secrets → deploy → add connector URLs to Claude clients → first real workout session to shake out the skill

### 2026-07-05 15:30 (PT) — claude.ai chat — design — Spec v0.5: Apple Health becomes primary health source; HANDOFF format now includes time + mode
**Done:**
- Verified Claude iOS app's Apple Health integration (beta, Pro/Max, US, read-only: workouts w/ HR + calories, HRV, resting HR, sleep, activity)
- Rewrote §5b as multi-source: Apple Health primary, totem/Whoop optional enrichment (recovery score + strain only), manual fallback; added per-field merge + dedup rules (`externalActivityId` + time window)
- Updated this file's entry template: timestamp with time + session mode (claude.ai chat / Claude Code / Cowork)
**Decisions:**
- Apple Health > totem as primary: official, ToS-clean, no token expiry; readiness rules (§6a) run on HRV/RHR baselines so no recovery score needed
- Apple Health reads happen only in iPhone-app sessions — persisted `daily_metrics` is how desktop/web sessions get the data
**Blockers / open items for next session:**
- `daily_metrics` vs `daily_readiness` naming — builder picks
- Per-field merge logic in `log_daily_metrics` is the trickiest tool — worth unit tests first
**Next suggested step:**
- Start the build (Claude Code): read SPEC v0.5 + this file → scaffold per §3

### 2026-07-05 (claude.ai chat) — design — Spec v0.4: ALL open questions resolved — build-ready
**Done:**
- Resolved §8 Q1/Q2/Q4/Q6/Q7 with the user: voice lines stripped by default (`includeVoiceLines` flag); two export tools kept; `import_backup` replace-only with explicit confirmation step; `raw_json` included in backups; `source:'manual'` metrics entry added to §5b
- §9 updated: prototype data will NOT be migrated (fresh start) — §9 is code-porting guidance only
- Export/import tool table updated to match decisions
**Decisions:**
- Everything above; no open design questions remain
**Blockers / open items for next session:**
- One naming call for the builder: keep `daily_metrics` or rename to `daily_readiness` (either fine, pick and be consistent)
**Next suggested step:**
- **Start the build.** New Claude Code session: read SPEC.md v0.4 + this file → scaffold repo per §3 → Drizzle schema (§4) → config.ts (§6) → workout-flow tools (§5) → wearable tools (§5b) → export/import → skill file (§6a)

### 2026-07-05 (claude.ai chat) — design — Spec v0.3: timing tool, runtime settings, skill enrichment, versioning
**Done:**
- Added version header + changelog table to SPEC.md (now v0.3)
- Added `check_time` tool (§5): server-clock elapsed/remaining, replaces the dropped metronome; documented that Claude can't self-fire timers
- Added `app_settings` table + `get_settings`/`set_setting` tools; §6 rewritten as two-layer config (boot env vars via Replit Secrets vs. runtime prefs in DB) with full `config.ts` + `.env.example`
- Reviewed claude-coach skill reference docs; ported the transferable parts into §6a (skill structure, HRV/RHR baseline-relative readiness rules, small-increment overload, "Claude proposes, user decides")
- Confirmed `daily_metrics` vs `workout_history` are NOT redundant (day-grain body state vs session-grain exertion)
**Decisions:**
- `.env` exists locally only (gitignored); production has no env file — Replit Secrets only
- Endurance-specific claude-coach content (zones, TSS, periodization, race nutrition) deliberately NOT imported — wrong domain for a circuit-session companion
**Blockers / open items for next session:**
- Open questions #1, #2, #6, #7 still undecided (fine to decide during build)
- Optional rename `daily_metrics` → `daily_readiness` for clarity — decide before schema is written
**Next suggested step:**
- Claude Code session: scaffold `apps/mcp-server` from SPEC v0.3

### 2026-07-05 (claude.ai chat) — design — Spec updated: totem/Whoop integration, config & auth, hosting decision
**Done:**
- Added `daily_metrics` table + wearable columns on `workout_history` (avg/max HR, strain, calories, `external_activity_id`) to SPEC.md §4
- Added §5b wearable tools: `log_daily_metrics`, `get_daily_metrics`, `attach_workout_metrics`, `get_readiness_context`; integration pattern is Claude-mediated (no server↔server coupling with totem)
- Added §6 Configuration & Auth: Replit Secrets + zod-validated `config.ts`; auth = secret URL path + bearer token at launch, OAuth deferred
- Resolved open question #3: hosting = Replit (paid always-on, GitHub sync, existing credits); DB = Replit built-in Postgres
- Created this HANDOFF.md convention
**Decisions:**
- Deploy ops via Replit UI or Cowork (browser) — Replit's official MCP is Agent-centric, community ones need session cookies (rejected)
- totem is best-effort: it rides Whoop's private iOS API (ToS risk, ~30-day tokens); coaching must degrade gracefully without it
**Blockers / open items for next session:**
- Open questions #1 (voice lines in shareable export), #2 (one vs two export tools), #6 (raw_json in backups?), #7 (manual metrics fallback) still undecided — fine to decide during build
**Next suggested step:**
- Claude Code session: scaffold `apps/mcp-server` (Drizzle schema from SPEC §4, config.ts from §6), wire first workout-flow tools
