import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config } from "./config.js";
import { createDb } from "./db/index.js";
import { createMcpServer } from "./server.js";

const db = createDb(config.DATABASE_URL);
const app = express();
app.use(express.json({ limit: "20mb" })); // image_data / raw_json payloads

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

/**
 * Auth (SPEC §6, layers 1+2):
 *  - layer 1: secret URL path  /mcp/<MCP_PATH_SECRET>  — covers clients that
 *    can't send headers (claude.ai web & mobile connector UI)
 *  - layer 2: Authorization: Bearer <MCP_AUTH_TOKEN> on /mcp — for Claude
 *    Code, scripts, and other header-capable clients
 * Never log request URLs: the path itself is a credential.
 */
function isAuthorized(path: string, authHeader: string | undefined): boolean {
  if (path === `/mcp/${config.MCP_PATH_SECRET}`) return true;
  if (path === "/mcp" && authHeader === `Bearer ${config.MCP_AUTH_TOKEN}`) {
    return true;
  }
  return false;
}

app.all(/^\/mcp(\/.*)?$/, async (req, res) => {
  if (!isAuthorized(req.path, req.headers.authorization)) {
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "unauthorized" },
      id: null,
    });
    return;
  }
  if (req.method !== "POST") {
    // stateless server: no SSE stream to resume, no session to delete
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "method not allowed" },
      id: null,
    });
    return;
  }
  try {
    // stateless mode: fresh server+transport per request so concurrent
    // clients (phone + desktop) can't collide on request ids
    const server = createMcpServer(db);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error("mcp request failed:", e instanceof Error ? e.message : e);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "internal server error" },
        id: null,
      });
    }
  }
});

app.listen(config.PORT, "0.0.0.0", () => {
  // deliberately not logging the secret path
  console.log(`workoutguide mcp-server listening on :${config.PORT}`);
});
