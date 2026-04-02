// Tool: compare_companies

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { logger } from "../utils/logger.js";
import { COMPARE_COMPANIES_INPUT, COMPARE_COMPANIES_OUTPUT } from "../types/index.js";
import { compareCompanies } from "../orchestrator/comparison.js";

const TOOL_NAME = "compare_companies" as const;

export function registerCompanyComparisonTool(server: McpServer): void {
  server.registerTool(
    TOOL_NAME,
    {
      description: `Compares exactly 2 companies side-by-side with a structured diff and AI narrative. Accepts company names or domains and returns a ranked comparison across funding, headcount, hiring velocity, Google search-interest momentum, company age, and industry overlap, plus a 3-5 sentence executive summary written by Grok.

Features:
- Parallel enrichment of both companies in a single call for fast results
- Deterministic diff: who raised more rounds, who has more employees, who is hiring faster, who is older
- Google Trends momentum: who has stronger recent search-interest movement
- Headcount trend comparison using accumulated snapshot data (grows richer over time)
- Job posting velocity delta: who is hiring more aggressively right now
- Handles partial failures gracefully; if one company cannot be enriched, returns what succeeded with an error note
- AI narrative synthesizes all signals into a concise executive summary

Try asking:
- "Compare Stripe and Adyen"
- "Which is growing faster, Notion or Linear?"
- "Compare the funding and hiring signals for Vercel vs Railway"
- "Compare OpenAI and Anthropic, who is hiring more and who has raised more?"
- "Is Rippling bigger than Deel? Compare them."

Notes:
- Pass domains (for example stripe.com) for fastest resolution; company names go through domain lookup first
- Use the location field on each company entry to disambiguate same-name companies
- Headcount trend data becomes richer over time as snapshots accumulate
- This is an execute-mode tool; each call runs 2 live enrichments`,
      inputSchema: COMPARE_COMPANIES_INPUT,
      outputSchema: COMPARE_COMPANIES_OUTPUT,
      _meta: {
        surface: "both",
        queryEligible: false,
        latencyClass: "slow",
        pricing: {
          executeUsd: "0.1",
        },
        rateLimit: {
          maxRequestsPerMinute: 10,
          cooldownMs: 5000,
          maxConcurrency: 3,
        },
      },
    },
    async (args) => {
      const { companies } = args;

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timed out after 30s")), 30_000),
      );

      try {
        logger.info(
          `compare_companies called for: ${companies.map((c) => c.query).join(", ")}`,
        );

        const output = await Promise.race([
          compareCompanies(companies),
          timeoutPromise,
        ]);

        return {
          structuredContent: output as unknown as Record<string, unknown>,
          content: [{ type: "text" as const, text: JSON.stringify(output) }],
        } as unknown as CallToolResult;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`compare_companies failed`, {
          error: msg,
          companies: companies.map((c) => c.query),
        });
        return {
          structuredContent: {
            companies: [],
            comparison: {
              funding: { rankedByRoundCount: [], totalRoundsByCompany: {}, latestRoundByCompany: {} },
              headcount: { rankedByEstimate: [], estimateByCompany: {}, trendByCompany: {}, changePercentByCompany: {} },
              hiring: { rankedByJobPostingCount: [], currentCountByCompany: {}, cappedByCompany: {}, trendByCompany: {} },
              searchInterest: { rankedByCurrentScore: [], rankedByMomentum: [], currentScoreByCompany: {}, recentAverageByCompany: {}, changePercentByCompany: {}, trendByCompany: {} },
              age: { rankedByAge: [], foundedYearByCompany: {} },
              industryOverlap: { allIndustries: [], byCompany: {}, shareIndustry: false },
              headquarters: { byCompany: {}, sameCity: false },
              leadership: { ceoByCompany: {}, ctoByCompany: {}, foundersByCompany: {} },
              growthSignals: { hiringVelocityByCompany: {}, fundingSignalsByCompany: {}, generalSignalsByCompany: {} },
              specialties: { byCompany: {}, sharedSpecialties: [], uniqueToEach: {} },
              dataQuality: { confidenceScoreByCompany: {}, sourcesUsedByCompany: {} },
            },
            narrative: `Error: ${msg}`,
            meta: {
              requestedCount: companies.length,
              succeededCount: 0,
              failedCount: companies.length,
              partialResult: false,
              durationMs: 0,
            },
          } as unknown as Record<string, unknown>,
          content: [{ type: "text" as const, text: msg }],
          isError: true,
        } as unknown as CallToolResult;
      }
    },
  );
}
