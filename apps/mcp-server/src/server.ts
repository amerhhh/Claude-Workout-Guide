import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Db } from "./db/index.js";
import { registerWorkoutTools } from "./tools/workout.js";
import { registerHistoryTools } from "./tools/history.js";
import { registerMetricsTools } from "./tools/metrics.js";
import { registerConfigTools } from "./tools/config.js";
import { registerExportImportTools } from "./tools/exportImport.js";
import { registerIdeasTools } from "./tools/ideas.js";
import { registerPlanTools } from "./tools/plans.js";

export function createMcpServer(db: Db): McpServer {
  const server = new McpServer({
    name: "workoutguide",
    version: "1.0.0",
  });
  registerWorkoutTools(server, db);
  registerHistoryTools(server, db);
  registerMetricsTools(server, db);
  registerConfigTools(server, db);
  registerExportImportTools(server, db);
  registerIdeasTools(server, db);
  registerPlanTools(server, db);
  return server;
}
