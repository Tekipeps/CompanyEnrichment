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
      description: `Enriches any company with firmographics, funding history, key personnel, and growth signals using live web data. Accepts a company name or domain and returns structured intelligence including industry, headcount, headquarters, founded year, funding rounds with investors, C-suite team with LinkedIn URLs, hiring velocity, and a 2-3 sentence executive synthesis.

Features:
- Accepts company name OR domain; auto-resolves product names to parent company (e.g. "jira" returns atlassian.com data)
- Live Exa web search for fresh data on every cache miss; 30-day intelligent cache for repeat calls
- Structured output: firmographics, funding rounds, key personnel with LinkedIn URLs, growth signals, data quality score
- Source weighting: official site > LinkedIn > news outlets > aggregators; discrepancies logged with resolution
- Confidence score (0-1) and sources list included on every response

Try asking:
- "What industry is ClickUp in and how many employees do they have?"
- "Who are the key executives at Notion?"
- "What is Vercel's latest funding round and valuation?"
- "Give me a full company profile for linear.app"
- "What growth signals exist for Zapier — hiring, funding, recent launches?"
- "Who founded Retool and what is their total funding?"
- "Compare the founding year and headquarters of Figma vs Canva"
- "Is monday.com publicly listed? What is their ARR?"
- "Find the CEO and CTO of a Nigerian fintech called Paystack"

Agent tips:
- Pass a domain (e.g. stripe.com) for fastest resolution; company names go through domain lookup first.
- Use the location field to disambiguate companies sharing the same name across countries.
- Results are cached for 30 days — repeat calls for the same company are near-instant.
- Confidence score below 0.7 means sparse data; check the discrepancies array for conflicts.`,
      inputSchema,
      outputSchema,
      _meta: {
        surface: "both",
        queryEligible: true,
        latencyClass: "slow",
        pricing: {
          executeUsd: "0.001",
        },
        rateLimit: {
          maxRequestsPerMinute: 20,
          cooldownMs: 3000,
          maxConcurrency: 5,
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
