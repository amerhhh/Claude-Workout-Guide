import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export function createDb(connectionString: string) {
  const pool = new pg.Pool({ connectionString });
  return drizzle(pool, { schema });
}

/**
 * The query-builder surface shared by the node-postgres driver (prod) and the
 * PGlite driver (tests) — tools are written against this so tests can inject
 * an in-process database.
 */
export type Db = Omit<ReturnType<typeof createDb>, "$client">;
export { schema };
