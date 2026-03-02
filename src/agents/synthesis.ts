import { GoogleGenAI, Type } from "@google/genai";
import type { CompanyIntelligence } from "../types/enrichment.js";
import type { LinkedInCompanyData } from "../types/linkedin.js";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ---------------------------------------------------------------------------
// Response Schema (mirrors CompanyIntelligence + DataQuality)
// ---------------------------------------------------------------------------

const COMPANY_INTELLIGENCE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    firmographics: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING },
        domain: { type: Type.STRING },
        industry: { type: Type.STRING },
        description: { type: Type.STRING },
        employeeCountEstimate: { type: Type.STRING },
        headquarters: { type: Type.STRING },
        foundedYear: { type: Type.NUMBER },
        specialties: { type: Type.ARRAY, items: { type: Type.STRING } },
        logoUrl: { type: Type.STRING },
      },
      required: ["name", "domain"],
    },
    fundingHistory: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          date: { type: Type.STRING },
          amount: { type: Type.STRING },
          roundType: { type: Type.STRING },
          leadInvestors: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
      },
    },
    keyPersonnel: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          title: { type: Type.STRING },
          profileUrl: { type: Type.STRING },
          photoUrl: { type: Type.STRING },
        },
        required: ["name", "title"],
      },
    },
    growthSignals: {
      type: Type.OBJECT,
      properties: {
        hiringVelocity: { type: Type.STRING },
        recentLeadershipChanges: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
        fundingSignals: { type: Type.STRING },
        generalSignals: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
    },
    synthesis: { type: Type.STRING },
    dataQuality: {
      type: Type.OBJECT,
      properties: {
        confidenceScore: { type: Type.NUMBER },
        sourcesUsed: { type: Type.ARRAY, items: { type: Type.STRING } },
        officialSourceFound: { type: Type.BOOLEAN },
        discrepancies: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              field: { type: Type.STRING },
              conflict: { type: Type.STRING },
              resolution: { type: Type.STRING },
            },
            required: ["field", "conflict", "resolution"],
          },
        },
      },
      required: [
        "confidenceScore",
        "sourcesUsed",
        "officialSourceFound",
        "discrepancies",
      ],
    },
  },
  required: ["firmographics", "fundingHistory", "keyPersonnel", "dataQuality"],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Formats scraped website content into a token-efficient section.
 * Truncated to avoid blowing up the prompt.
 */
const formatWebsiteData = (
  domain: string,
  websiteContent: string | null,
): string => {
  if (!websiteContent || websiteContent.trim().length < 50) {
    return `=== Official Website (${domain}) ===\nNot available or insufficient content.`;
  }

  const MAX_WEBSITE_CHARS = 8_000;
  const truncated = websiteContent.slice(0, MAX_WEBSITE_CHARS);

  return `=== Official Website (${domain}) ===\n${truncated}`;
};

/**
 * Truncates LinkedIn content to avoid flooding the prompt while
 * keeping the structured fields (employees, posts, logo).
 */
const formatLinkedInData = (data: LinkedInCompanyData | null): string => {
  if (!data) return "=== LinkedIn Company Page ===\nNot available.";

  const MAX_CONTENT_CHARS = 6_000;

  const parts: string[] = ["=== LinkedIn Company Page ==="];

  if (data.name) parts.push(`Company Name: ${data.name}`);
  if (data.industry) parts.push(`Industry: ${data.industry}`);
  if (data.companySize) parts.push(`Company Size: ${data.companySize}`);
  if (data.headquarters) parts.push(`Headquarters: ${data.headquarters}`);
  if (data.founded) parts.push(`Founded: ${data.founded}`);
  if (data.specialties) parts.push(`Specialties: ${data.specialties}`);
  if (data.description)
    parts.push(`Description: ${data.description.slice(0, 1_000)}`);

  if (data.LINKEDIN_EMPLOYEES?.length) {
    parts.push(
      `\nKey Employees (${data.LINKEDIN_EMPLOYEES.length} found):\n` +
        data.LINKEDIN_EMPLOYEES.slice(0, 10)
          .map(
            (e) =>
              `  - ${e.name} | ${e.title}${e.profileUrl ? ` | ${e.profileUrl}` : ""}`,
          )
          .join("\n"),
    );
  }

  if (data.LINKEDIN_POSTS?.length) {
    parts.push(
      `\nRecent Posts:\n` +
        data.LINKEDIN_POSTS.slice(0, 3)
          .map((p) => `  [${p.timeAgo}] ${(p.text || "").slice(0, 300)}`)
          .join("\n"),
    );
  }

  if (data.LINKEDIN_LOGO_URL) {
    parts.push(`Logo URL: ${data.LINKEDIN_LOGO_URL}`);
  }

  // Append raw page content (truncated) as a fallback for anything missed above
  if (data.content) {
    parts.push(
      `\nPage Content (truncated):\n${data.content.slice(0, MAX_CONTENT_CHARS)}`,
    );
  }

  return parts.join("\n");
};

// ---------------------------------------------------------------------------
// Main Export
// ---------------------------------------------------------------------------

/**
 * Synthesizes scraped website + LinkedIn data into a structured
 * CompanyIntelligence object using Gemini with JSON output mode.
 *
 * Source Trust Hierarchy (highest → lowest):
 *   1. Official company website (scraped content)
 *   2. LinkedIn company page
 *   3. Professional news media
 *   4. Third-party aggregators
 */
export const synthesizeCompanyProfile = async (
  domain: string,
  linkedInData: LinkedInCompanyData | null,
  websiteContent: string | null,
): Promise<CompanyIntelligence> => {
  const websiteSection = formatWebsiteData(domain, websiteContent);
  const linkedInSection = formatLinkedInData(linkedInData);

  const prompt = `
You are an expert financial and firmographic data analyst.

Your task is to synthesize raw data from multiple sources into a clean, accurate Company Intelligence report for the company with domain: "${domain}".

## Source Data

${websiteSection}

---

${linkedInSection}

## Instructions

**Source Weighting (apply in this order when data conflicts):**
1. HIGHEST TRUST — Official company website content (scraped directly from ${domain})
2. HIGH TRUST — LinkedIn company page (first-party social presence)
3. MEDIUM TRUST — Reputable news outlets (TechCrunch, Bloomberg, Reuters, Forbes, etc.)
4. LOW TRUST — Third-party aggregators (Crunchbase, PitchBook, ZoomInfo, etc.)

**Discrepancy Detection:**
- Actively compare values across the official website and LinkedIn (e.g. employee count, HQ location, founding year, description, specialties).
- If the two sources disagree on a value, record it in the "discrepancies" array with:
  - "field": the field name (e.g. "employeeCountEstimate")
  - "conflict": a concise description of what each source says
  - "resolution": which value you chose and why (cite the higher-trust source)

**Confidence Score:**
- Score 0.0–1.0 based on data richness and source quality.
- 0.9+ = both official website and LinkedIn agree, rich data
- 0.7–0.9 = one strong source, minor gaps
- 0.5–0.7 = limited sources, some uncertainty
- <0.5 = sparse data, high uncertainty

**sourcesUsed field:**
- List the actual source types that provided useful data (e.g. "Official Website (${domain})", "LinkedIn Company Page").
- Set officialSourceFound to true if the website content was successfully scraped and contributed data.

**Google Search (Grounding) Usage:**
- You have access to Google Search. You MUST use it to search the web for any critical missing information that is not present in the provided source data.
- If the official website and LinkedIn data are sparse, or if they are completely missing (e.g. for a very new or private company), aggressively use Google Search to find:
  - Firmographics (headquarters, employee count, founding year)
  - Recent funding rounds and investors (search for "${domain} funding", "${domain} raised")
  - Key personnel (CEO, founders, executives)
  - Recent news and growth signals
- If you find information via Google Search, list "Google Search" in the "sourcesUsed" array.

**Output requirements:**
- Extract firmographics, funding history, key personnel (C-suite / VP level), growth signals.
- In "synthesis", write a 2–3 sentence executive summary of the company.
- Fill "dataQuality" with confidence score, sources used, officialSourceFound flag, and any discrepancies.
- Return ONLY valid JSON matching the required schema. Do not add any text outside JSON.
`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: COMPANY_INTELLIGENCE_SCHEMA,
        temperature: 0.1, // Low temperature for factual accuracy
      },
    });

    const raw = response.text || "{}";
    const parsed = JSON.parse(raw) as CompanyIntelligence;

    // Ensure required arrays always exist even if Gemini omits them
    parsed.fundingHistory = parsed.fundingHistory ?? [];
    parsed.keyPersonnel = parsed.keyPersonnel ?? [];

    // Ensure firmographics domain is always set
    if (parsed.firmographics) {
      parsed.firmographics.domain = parsed.firmographics.domain || domain;

      // Populate logo URL from LinkedIn if Gemini didn't include it
      if (!parsed.firmographics.logoUrl && linkedInData?.LINKEDIN_LOGO_URL) {
        parsed.firmographics.logoUrl = linkedInData.LINKEDIN_LOGO_URL;
      }
    }

    return parsed;
  } catch (e) {
    console.error("[Synthesis Error] Failed to parse Gemini response:", e);
    throw new Error(
      `Failed to synthesize company profile: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
};
