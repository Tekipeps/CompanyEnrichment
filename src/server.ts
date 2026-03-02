import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export const server = new McpServer({
  name: "company-enrichment-mcp",
  version: "0.1.0",
});

// ============================================================================
// Tool Schemas
// ============================================================================

const ENRICH_COMPANY_INPUT = {
  domain: z.string().describe("The domain of the company (e.g., google.com)"),
};

const ENRICH_COMPANY_OUTPUT = z.object({
  domain: z.string(),
  company_name: z.string(),
  enriched: z.boolean(),
  timestamp: z.string(),
});

// ============================================================================
// Tool Registrations
// ============================================================================

/**
 * Enrich company data using a domain name.
 * outputSchema is REQUIRED by Context for dispute resolution and verification.
 */
server.registerTool(
  "enrich_company",
  {
    description: "Enrich company data using a domain name",
    inputSchema: ENRICH_COMPANY_INPUT,
    outputSchema: ENRICH_COMPANY_OUTPUT,
    _meta: {
      surface: "both",
      pricing: {
        executeUsd: 0.001,
      },
    },
  },
  async ({ domain }) => {
    const result = {
      domain,
      company_name: (domain.split(".")[0] || "Unknown").toUpperCase(),
      enriched: true,
      timestamp: new Date().toISOString(),
    };

    return {
      content: [
        {
          type: "text",
          text: `Enriched data for ${domain}: ${JSON.stringify(result, null, 2)}`,
        },
      ],
      structuredContent: result, // REQUIRED by Context
    };
  },
);
