// MCP server setup with HTTP transport
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerCompanyEnrichmentTool } from "./tools/enrich-company.js";
import type { Request, Response } from "express";
import { rateLimiter } from "./middleware/rateLimit.js";
import { rapidApiAuth } from "./middleware/rapidApi.js";
import { apiRouter } from "./routes/api.js";
import { createContextMiddleware } from "@ctxprotocol/sdk";

const PORT = Number(process.env.PORT) || 3000;

export function createServer(): McpServer {
  const server = new McpServer({
    name: "CompanyEnrichmentMCP",
    version: "1.0.0",
  });

  registerCompanyEnrichmentTool(server);

  return server;
}

export async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json());

  // Stateless MCP handler — each request gets its own transport + server instance
  // This is safe because our tools are stateless (no shared mutable state)
  app.post(
    "/mcp",
    // createContextMiddleware({}),
    async (req: Request, res: Response) => {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless mode
      });

      const server = createServer();

      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(
          `[CompanyEnrichment] MCP request error: ${message}\n`,
        );
        if (!res.headersSent) {
          res
            .status(500)
            .json({ error: true, code: "INTERNAL_ERROR", message });
        }
      }
    },
  );

  // Health check endpoint — used by Railway/Render to confirm the service is up
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", service: "CompanyEnrichment", version: "1.0.0" });
  });

  // REST API layer for RapidAPI — rate limit then auth then routes
  app.use("/api", rateLimiter);
  app.use("/api", rapidApiAuth);
  app.use("/api", apiRouter);

  app.listen(PORT, () => {
    process.stderr.write(
      `CompanyEnrichment MCP server running on port ${PORT}\n`,
    );
  });
}
