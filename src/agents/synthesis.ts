import { GoogleGenAI, Type } from "@google/genai";
import type { CompanyIntelligence } from "../types/enrichment.js";

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
// Main Export
// ---------------------------------------------------------------------------

/**
 * Synthesizes a structured CompanyIntelligence object for a given company.
 * Accepts either a domain (e.g. "stripe.com") or a company name (e.g. "Stripe").
 * An optional location narrows the search when multiple companies share the same name.
 */
export const synthesizeCompanyProfile = async (
  query: string,
  location?: string,
): Promise<CompanyIntelligence> => {
  const locationHint = location ? ` located in ${location}` : "";
  const isDomain = query.includes(".");
  const subjectLine = isDomain
    ? `the company at domain "${query}"${location ? ` (${locationHint.trim()})` : ""}`
    : `the company named "${query}"${locationHint}`;
  const prompt = `
You are an expert financial and firmographic data analyst.

Your task is to research ${subjectLine} and produce a clean, accurate Company Intelligence report.

${
  isDomain
    ? ""
    : `**Step 1 — Identify the company:**
Use Google Search to find the official website and domain for "${query}"${locationHint}. Use the discovered domain throughout the rest of your research.\n\n`
}**Research the following using Google Search:**
- Official company name
- Industry / sector
- Short company description
- Estimated employee count (use ranges like "1,000–5,000" when exact numbers are unavailable)
- Headquarters (city, country)
- Year founded
- Key specialties / product areas
- Official logo URL (search for it on the company's website or LinkedIn)

**Funding History**
- Search: "${query} funding rounds", "${query} raised", "${query} series A B C"
- For each round: date, amount raised, round type (Seed, Series A, etc.), lead investors

**Key Personnel**
- Search: "${query} CEO founder executive team leadership"
- Extract C-suite and VP-level names, titles, and LinkedIn profile URLs

**Growth Signals**
- Hiring velocity: is the company actively hiring? (check LinkedIn Jobs)
- Recent leadership changes (new CEO, CFO, etc. in the last 12 months)
- Funding signals (recent raise, rumoured raise)
- General signals: expansions, product launches, partnerships, awards

**Source Weighting (apply when data conflicts):**
1. HIGHEST — Official company website (${query})
2. HIGH — LinkedIn company page
3. MEDIUM — Reputable news outlets (TechCrunch, Bloomberg, Reuters, Forbes)
4. LOW — Third-party aggregators (Crunchbase, PitchBook, ZoomInfo)

**Discrepancy Detection:**
- If two sources disagree on a value, record it in the "discrepancies" array:
  - "field": the field name (e.g. "employeeCountEstimate")
  - "conflict": what each source says
  - "resolution": which value you chose and why

**Confidence Score (0.0–1.0):**
- 0.9+ = multiple strong sources agree, rich data
- 0.7–0.9 = one strong source with minor gaps
- 0.5–0.7 = limited sources, some uncertainty
- <0.5 = sparse data, high uncertainty

**sourcesUsed field:**
- List every source type that contributed data (e.g. "Official Website (${query})", "LinkedIn", "Google Search", "TechCrunch")
- Set officialSourceFound to true if you successfully retrieved data from the company's own website

**Output:**
- In "synthesis", write a 2–3 sentence executive summary of the company.
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
      parsed.firmographics.domain =
        parsed.firmographics.domain || (isDomain ? query : "");
    }

    return parsed;
  } catch (e) {
    console.error("[Synthesis Error] Failed to synthesize company profile:", e);
    throw new Error(
      `Failed to synthesize company profile: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
};

/**
 * Fast GoogleGenAI call to reliably identify the main website domain for a given
 * company name. Essential for correct cache utilization when the user enters a
 * plain name instead of a domain. Returns null if the company definitively has no website.
 */
export const resolveCompanyDomain = async (
  query: string,
  location?: string,
): Promise<string | null> => {
  const locationHint = location ? ` located in ${location}` : "";
  const prompt = `
You are an expert firmographic data analyst.
Task: Find the official website domain for the company named "${query}"${locationHint}.
Research using Google Search.

Output requirement: 
- Return ONLY the bare domain string (e.g. "stripe.com") in your response.
- Do NOT output "https://", "www.", paths, or any other conversational text whatsoever.
- If the organization definitively does not have ANY website, output exactly "null".
`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        temperature: 0.1, // Low temperature for high precision
      },
    });

    const rawResult = (response.text || "").trim().toLowerCase();

    // Safety check against conversational outputs or missing websites
    if (!rawResult || rawResult === "null" || rawResult.includes(" ")) {
      return null;
    }

    // Strip out remaining protocol/www just in case Gemini ignored instructions
    let domain = rawResult;
    domain = domain.replace(/^https?:\/\//, "");
    domain = domain.replace(/^www\./, "");
    domain = domain.replace(/\/.*$/, "");

    return domain.includes(".") ? domain : null;
  } catch (e) {
    console.error(
      `[Synthesis Error] Failed to resolve domain for "${query}":`,
      e,
    );
    return null; // Fallback gracefully internally
  }
};
