import { getCachedCompanyData, saveCompanyData } from "../services/db.js";
import { searchGoogle } from "../services/google-search.js";
import { scrapeLinkedInCompany } from "../services/linkedin-company-scraper.js";
import { scrape } from "../services/scraper.js";
import { synthesizeCompanyProfile } from "../agents/synthesis.js";
import type { CompanyIntelligence } from "../types/enrichment.js";

/**
 * Normalizes a domain input to a consistent bare format: "example.com"
 * Strips protocols, www prefix, trailing slashes, and paths.
 */
const normalizeDomain = (input: string): string => {
  let d = input.trim().toLowerCase();
  // Remove protocol
  d = d.replace(/^https?:\/\//, "");
  // Remove www.
  d = d.replace(/^www\./, "");
  // Remove trailing slash and any path
  d = d.replace(/\/.*$/, "");
  return d;
};

export const enrichCompany = async (
  rawDomain: string,
): Promise<CompanyIntelligence> => {
  const domain = normalizeDomain(rawDomain);
  console.log(`[Orchestrator] Starting enrichment for: ${domain}`);

  // 1. Check cache
  const cached = await getCachedCompanyData(domain);
  if (cached) {
    console.log(`[Orchestrator] Cache hit for: ${domain}`);
    return cached;
  }

  // 2. Scrape the company's own website for primary data
  console.log(`[Orchestrator] Scraping company website: ${domain}`);
  let websiteData: string | null = null;
  try {
    const siteResult = await scrape({
      url: domain,
      extractLinks: false,
      extractMetaTitle: true,
      excludeHeaderAndFooter: false,
    });

    if (siteResult) {
      if (typeof siteResult === "string") {
        websiteData = siteResult;
      } else if (
        "content" in siteResult &&
        typeof siteResult.content === "string"
      ) {
        websiteData = siteResult.content;
      }
    }

    if (websiteData) {
      console.log(
        `[Orchestrator] Website scraped successfully (${websiteData.length} chars)`,
      );
    } else {
      console.warn(`[Orchestrator] Website scrape returned no content`);
    }
  } catch (err) {
    console.warn(
      `[Orchestrator] Failed to scrape company website: ${err instanceof Error ? err.message : err}`,
    );
  }

  // 3. Find LinkedIn Company URL via Google Search
  let linkedInUrl: string | null = null;
  const linkedInSearch = await searchGoogle(
    `site:linkedin.com/company "${domain}"`,
    { nbResults: 1 },
  );

  if (linkedInSearch && linkedInSearch.organic_results.length > 0) {
    linkedInUrl = linkedInSearch.organic_results[0]?.url || null;
  }

  // 4. Scrape LinkedIn Data
  let linkedInData = null;
  if (linkedInUrl) {
    console.log(
      `[Orchestrator] Found LinkedIn URL: ${linkedInUrl}, scraping...`,
    );
    const scrapeResult = await scrapeLinkedInCompany(linkedInUrl);
    if (scrapeResult.success) {
      linkedInData = scrapeResult.data ?? null;
    } else {
      console.warn(
        `[Orchestrator] LinkedIn scrape failed: ${scrapeResult.error}`,
      );
    }
  } else {
    console.warn(`[Orchestrator] No LinkedIn URL found for: ${domain}`);
  }

  // 5. Synthesize all raw data via Gemini in a single LLM call
  //    Pass: website content + LinkedIn data (no news search — it returns 0 results)
  console.log(`[Orchestrator] Synthesizing intelligence via Gemini...`);
  const finalIntelligence = await synthesizeCompanyProfile(
    domain,
    linkedInData ?? null,
    websiteData,
  );

  // 6. Persist to cache
  await saveCompanyData(
    domain,
    finalIntelligence.firmographics?.name || domain,
    finalIntelligence,
  );

  console.log(
    `[Orchestrator] Enrichment complete for: ${domain} | confidence: ${finalIntelligence.dataQuality?.confidenceScore ?? "n/a"}`,
  );

  return finalIntelligence;
};
