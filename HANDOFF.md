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
