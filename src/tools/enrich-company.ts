// Tool: enrich_company

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { logger } from "../utils/logger.js";
import { ENRICH_COMPANY_INPUT, ENRICH_COMPANY_OUTPUT } from "../types/index.js";
import { enrichCompany } from "../orchestrator/enrichment.js";

const TOOL_NAME = "enrich_company" as const;

const inputSchema = ENRICH_COMPANY_INPUT;

const outputSchema = ENRICH_COMPANY_OUTPUT;

export function registerCompanyEnrichmentTool(server: McpServer): void {
  server.registerTool(
    TOOL_NAME,
    {
      description:
        "Enriches a company with detailed information based on the company domain/name and location.",
      inputSchema,
      outputSchema,
    },
    async (args) => {
      const { query, location } = args;

      try {
        logger.info(`enrich_company called for: ${query}`);

        const output = await enrichCompany(query, location);

        return {
          structuredContent: output as unknown as Record<string, unknown>,
          content: [{ type: "text" as const, text: JSON.stringify(output) }],
        } as unknown as CallToolResult;
      } catch (err: unknown) {
        logger.error(`enrich_company failed for: ${query}`, {
          error: err instanceof Error ? err.message : String(err),
        });
        return {
          structuredContent: { error: true },
          content: [{ type: "text" as const, text: "Enrichment failed" }],
          isError: true,
        } as unknown as CallToolResult;
      }
    },
  );
}
