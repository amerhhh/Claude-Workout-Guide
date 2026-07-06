import { z } from "zod";
import "dotenv/config"; // no-op in prod (no .env file); loads .env locally

const ConfigSchema = z.object({
  DATABASE_URL: z.string().url(),
  MCP_AUTH_TOKEN: z.string().min(32), // bearer token for header-capable clients
  MCP_PATH_SECRET: z.string().min(32), // server mounts at /mcp/${MCP_PATH_SECRET}
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

const parsed = ConfigSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("❌ Invalid configuration:\n", parsed.error.flatten().fieldErrors);
  process.exit(1); // crash loudly at boot, never run misconfigured
}
export const config = parsed.data;
