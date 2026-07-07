# WorkoutGuide MCP

A guided workout companion that lives entirely inside conversations with Claude.
No app, no screen mid-workout — Claude is the coach, this MCP server is the memory
(exercise config, per-attempt logs, streaks, health metrics from Apple Health /
Whoop / manual entry).

Design truth: [SPEC.md](SPEC.md) · State truth: [HANDOFF.md](HANDOFF.md) ·
Coaching personality: [skills/workout-coach.md](skills/workout-coach.md)

## Layout

```
apps/mcp-server/    MCP server (Express + StreamableHTTP), Drizzle + Postgres
packages/shared/    zod schemas — source of truth for tool inputs & payloads
skills/             workout-coach.md coaching skill
```

## Local dev

```bash
pnpm install
cp .env.example .env          # fill in real values (openssl rand -hex 32 for secrets)
pnpm db:migrate               # applies apps/mcp-server/drizzle/*.sql
pnpm dev                      # tsx watch
pnpm test                     # vitest: merge/streak units + full e2e vs in-process Postgres
```

## Production (Replit)

- Repl: `Claude-Workout-Guide` — deploys from this repo via GitHub sync (repo is
  the source of truth, never edit on Replit directly).
- Add the built-in **PostgreSQL** database to the Repl (provides `DATABASE_URL`).
- **Replit Secrets** (no `.env` in prod): `MCP_AUTH_TOKEN`, `MCP_PATH_SECRET`
  (both `openssl rand -hex 32`), optionally `PORT` (default 3000), `LOG_LEVEL`.
- `.replit` builds with pnpm, runs migrations, and starts the server on a
  reserved VM (always-on, required for an MCP endpoint).

## Connecting Claude

| Client | URL | Auth |
|---|---|---|
| claude.ai web / iOS connector | `https://<repl-domain>/api/mcp/<MCP_PATH_SECRET>` | secret path (layer 1) |
| Claude Code / API clients | `https://<repl-domain>/api/mcp` | `Authorization: Bearer <MCP_AUTH_TOKEN>` (layer 2) |

Both `/api/mcp/…` and bare `/mcp/…` mounts are served. Health check: `GET /api/healthz` (or `/healthz`). Rotate either secret in Replit Secrets → redeploy →
update the connector URL. Worst case: rotate, wipe DB, `import_backup`.

## Schema notes (differences from SPEC §4)

- `exercise_logs.rest_started_at` — added so `check_time` can measure an
  in-flight rest against the server clock.
- `exercises.retired_at` — exercises with logged history are retired (hidden,
  history preserved) instead of hard-deleted; template switches use this too.
- Backups carry a `looseLogs` array for attempts logged outside any session.
