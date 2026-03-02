import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createContextMiddleware } from "@ctxprotocol/sdk";
import { server } from "./server";

const router = Router();

// Session management for Streamable HTTP
const transports: Record<string, StreamableHTTPServerTransport> = {};

// Context Protocol security middleware
// Mandatory for paid tools; good practice for all tools.
const verifyContextAuth = createContextMiddleware();

// Health check
router.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    server: "company-enrichment-mcp",
    version: "0.1.0",
  });
});

// MCP POST endpoint (initialize + tool calls)
router.post("/mcp", verifyContextAuth, async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  let transport: StreamableHTTPServerTransport;

  if (sessionId && transports[sessionId]) {
    transport = transports[sessionId];
  } else if (!sessionId && isInitializeRequest(req.body)) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        transports[id] = transport;
      },
    });
    await server.connect(transport);
  } else {
    res
      .status(400)
      .json({ error: "Invalid session or missing initialize request" });
    return;
  }

  await transport.handleRequest(req, res, req.body);
});

// MCP GET endpoint (SSE streaming)
router.get("/mcp", verifyContextAuth, async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string;
  const transport = transports[sessionId];

  if (transport) {
    await transport.handleRequest(req, res);
  } else {
    res.status(400).json({ error: "Invalid or expired session" });
  }
});

export default router;
