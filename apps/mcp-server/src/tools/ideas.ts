import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { desc, eq, ilike, isNull } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { ideas, workoutHistory } from "../db/schema.js";
import { ok, err } from "../lib/respond.js";

export function registerIdeasTools(server: McpServer, db: Db) {
  server.registerTool(
    "log_idea",
    {
      title: "Log idea",
      description:
        "Captures a freeform thought/idea the user voices (often mid-run) — separate from workout notes, searchable later. Auto-links to the active workout session if one is open. Log ideas the moment the user says them.",
      inputSchema: {
        content: z.string().min(1),
        context: z.string().optional(),
      },
    },
    async ({ content, context }) => {
      const [active] = await db
        .select({ id: workoutHistory.id })
        .from(workoutHistory)
        .where(isNull(workoutHistory.completedAt))
        .orderBy(desc(workoutHistory.startedAt))
        .limit(1);
      const [row] = await db
        .insert(ideas)
        .values({
          content,
          context: context ?? null,
          workoutHistoryId: active?.id ?? null,
        })
        .returning();
      return ok({
        id: row.id,
        content: row.content,
        linkedToWorkout: row.workoutHistoryId,
        createdAt: row.createdAt,
      });
    },
  );

  server.registerTool(
    "list_ideas",
    {
      title: "List ideas",
      description:
        "Recent ideas, newest first. Optional case-insensitive text search and limit.",
      inputSchema: {
        search: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    async ({ search, limit }) => {
      const rows = await db
        .select()
        .from(ideas)
        .where(search ? ilike(ideas.content, `%${search}%`) : undefined)
        .orderBy(desc(ideas.id))
        .limit(limit ?? 25);
      return ok(rows);
    },
  );

  server.registerTool(
    "delete_idea",
    {
      title: "Delete idea",
      description: "Removes one idea by id.",
      inputSchema: { id: z.number().int() },
    },
    async ({ id }) => {
      const [row] = await db.delete(ideas).where(eq(ideas.id, id)).returning();
      if (!row) return err(`idea ${id} not found`);
      return ok({ id, deleted: true });
    },
  );
}
