import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { enrichCompany } from "./orchestrator/enrichment.js";

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

// We match the Zod schema representing what the orchestrator returns
const ENRICH_COMPANY_OUTPUT = z.any(); // Returning the full CompanyIntelligence object

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
        executeUsd: 0.1, // Pricing based on PROPOSAL.md target
      },
    },
  },
  async ({ domain }) => {
    try {
      const result = await enrichCompany(domain);

      return {
        content: [
          {
            type: "text",
            text: `Enriched data for ${domain}: \n${JSON.stringify(result, null, 2)}`,
          },
        ],
        structuredContent: result as any, // REQUIRED by Context
      };
    } catch (e) {
      console.error(`[Tool Error] enrichment failed for ${domain}:`, e);
      return {
        content: [
          {
            type: "text",
            text: `Enrichment failed for ${domain}: ${e instanceof Error ? e.message : "Unknown error"}`,
          },
        ],
        isError: true,
        structuredContent: { error: true },
      };
    }
  },
);
