import { getCachedCompanyData, saveCompanyData } from "../services/db.js";
import {
  synthesizeCompanyProfile,
  resolveCompanyDomain,
} from "../agents/synthesis.js";
import type { CompanyIntelligence } from "../types/index.js";

/**
 * Normalizes a domain input to a consistent bare format: "example.com"
 * Strips protocols, www prefix, trailing slashes, and paths.
 * Returns null if the input looks like a plain company name (no dots).
 */
const tryNormalizeDomain = (input: string): string | null => {
  let d = input.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "");
  d = d.replace(/^www\./, "");
  d = d.replace(/\/.*$/, "");
  // If it still has a dot it's likely a domain (e.g. "stripe.com")
  return d.includes(".") ? d : null;
};

/**
 * Enriches a company given either a domain or a company name.
 * An optional location can be provided to disambiguate companies
 * with the same name in different countries/cities.
 */
export const enrichCompany = async (
  query: string,
  location?: string,
): Promise<CompanyIntelligence> => {
  // Use the domain as the cache key when it's clearly a domain.
  // Otherwise, use AI to resolve the domain before checking the cache.
  // Fall back to the raw query (lowercased) if domain resolution yields null.
  let cacheKey = query.trim().toLowerCase();
  const maybeDomain = tryNormalizeDomain(query);

  if (maybeDomain) {
    cacheKey = maybeDomain;
  } else {
    console.log(
      `[Orchestrator] Attempting to resolve domain for: "${query}"${location ? ` (${location})` : ""}`,
    );
    const resolvedDomain = await resolveCompanyDomain(query, location);
    if (resolvedDomain) {
      console.log(`[Orchestrator] Resolved domain name: ${resolvedDomain}`);
      cacheKey = resolvedDomain;
    } else {
      console.log(
        `[Orchestrator] Could not resolve a domain for "${query}", falling back to query string key.`,
      );
    }
  }

  console.log(
    `[Orchestrator] Starting enrichment for: "${query}"${location ? ` (${location})` : ""}`,
  );

  // 1. Check cache
  const cached = await getCachedCompanyData(cacheKey);
  if (cached) {
    console.log(`[Orchestrator] Cache hit for: ${cacheKey}`);
    return cached;
  }

  // 2. Synthesize via Gemini + Google Search grounding
  console.log(
    `[Orchestrator] Synthesizing intelligence via Gemini (Google Search)...`,
  );
  const finalIntelligence = await synthesizeCompanyProfile(query, location);

  // 3. Persist to cache
  await saveCompanyData(
    cacheKey,
    finalIntelligence.firmographics?.name || cacheKey,
    finalIntelligence,
  );

  console.log(
    `[Orchestrator] Enrichment complete for: ${cacheKey} | confidence: ${finalIntelligence.dataQuality?.confidenceScore ?? "n/a"}`,
  );

  return finalIntelligence;
};
