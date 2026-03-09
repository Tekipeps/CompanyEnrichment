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
      _meta: {
        surface: "both",
        queryEligible: true,
        latencyClass: "slow",
        pricing: {
          executeUsd: "0.1",
        },
      },
    },
    async (args) => {
      const { query, location } = args;

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timed out after 28s")), 28_000),
      );

      try {
        logger.info(`enrich_company called for: ${query}`);

        const output = await Promise.race([
          enrichCompany(query, location),
          timeoutPromise,
        ]);

        return {
          structuredContent: output as unknown as Record<string, unknown>,
          content: [{ type: "text" as const, text: JSON.stringify(output) }],
        } as unknown as CallToolResult;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`enrich_company failed for: ${query}`, { error: msg });
        return {
          structuredContent: {
            firmographics: { name: query, domain: "" },
            fundingHistory: [],
            keyPersonnel: [],
            synthesis: `Error: ${msg}`,
            dataQuality: {
              confidenceScore: 0,
              sourcesUsed: [],
              officialSourceFound: false,
              discrepancies: [],
            },
          } as unknown as Record<string, unknown>,
          content: [{ type: "text" as const, text: msg }],
          isError: true,
        } as unknown as CallToolResult;
      }
    },
  );
}
