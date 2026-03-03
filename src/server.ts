import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { enrichCompany } from "./orchestrator/enrichment.js";
import { ENRICH_COMPANY_OUTPUT } from "./types/enrichment.js";

export const server = new McpServer({
  name: "company-enrichment-mcp",
  version: "0.1.0",
});

// ============================================================================
// Tool Schemas
// ============================================================================

const ENRICH_COMPANY_INPUT = {
  query: z
    .string()
    .describe(
      "The company domain (e.g., stripe.com) OR company name (e.g., Stripe). Google Search will resolve the correct company.",
    ),
  location: z
    .string()
    .optional()
    .describe(
      'Optional country or city to disambiguate companies with the same name (e.g., "United Kingdom" or "Lagos").',
    ),
};

// ============================================================================
// Tool Registrations
// ============================================================================

/**
 * Enrich company data using a domain or company name.
 * outputSchema is REQUIRED by Context for dispute resolution and verification.
 */
server.registerTool(
  "enrich_company",
  {
    description:
      "Enrich company data. Accepts a domain (e.g., stripe.com) or a company name (e.g., Stripe). Optionally supply a location (country/city) to disambiguate companies with the same name.",
    inputSchema: ENRICH_COMPANY_INPUT,
    outputSchema: ENRICH_COMPANY_OUTPUT,
    _meta: {
      surface: "both",
      pricing: {
        executeUsd: 0.1,
      },
    },
  },
  async ({ query, location }) => {
    try {
      const result = await enrichCompany(query, location);
      const label = location ? `${query} (${location})` : query;

      return {
        content: [
          {
            type: "text",
            text: `Company Intelligence: ${label}\n${JSON.stringify(result, null, 2)}`,
          },
        ],
        structuredContent: result as unknown as Record<string, unknown>, // REQUIRED by Context
      };
    } catch (e) {
      console.error(`[Tool Error] enrichment failed for ${query}:`, e);
      return {
        content: [
          {
            type: "text",
            text: `Enrichment failed for ${query}: ${e instanceof Error ? e.message : "Unknown error"}`,
          },
        ],
        isError: true,
        structuredContent: { error: true },
      };
    }
  },
);
