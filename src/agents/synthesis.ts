import type { CompanyIntelligence } from "../types/index.js";
import {
  searchCompanyProfile,
  searchFundingHistory,
  searchKeyPersonnel,
  type ExaResult,
} from "../data/exa.js";

const XAI_BASE_URL = "https://api.x.ai/v1";
const XAI_API_KEY = process.env.XAI_API_KEY ?? "";

const isDev = process.env.NODE_ENV !== "production";

// ---------------------------------------------------------------------------
// JSON Schema for grok-3-mini structured output
// ---------------------------------------------------------------------------

const COMPANY_INTELLIGENCE_JSON_SCHEMA = {
  type: "object",
  properties: {
    firmographics: {
      type: "object",
      properties: {
        name: { type: "string" },
        domain: { type: "string" },
        industry: { type: "string" },
        description: { type: "string" },
        employeeCountEstimate: { type: "string" },
        headquarters: { type: "string" },
        foundedYear: { type: "number" },
        specialties: { type: "array", items: { type: "string" } },
        logoUrl: { type: "string" },
      },
      required: ["name", "domain"],
    },
    fundingHistory: {
      type: "array",
      items: {
        type: "object",
        properties: {
          date: { type: "string" },
          amount: { type: "string" },
          roundType: { type: "string" },
          leadInvestors: { type: "array", items: { type: "string" } },
        },
      },
    },
    keyPersonnel: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          title: { type: "string" },
          profileUrl: { type: "string" },
          photoUrl: { type: "string" },
        },
        required: ["name", "title"],
      },
    },
    growthSignals: {
      type: "object",
      properties: {
        hiringVelocity: { type: "string" },
        recentLeadershipChanges: { type: "array", items: { type: "string" } },
        fundingSignals: { type: "string" },
        generalSignals: { type: "array", items: { type: "string" } },
      },
    },
    synthesis: { type: "string" },
    dataQuality: {
      type: "object",
      properties: {
        confidenceScore: { type: "number" },
        sourcesUsed: { type: "array", items: { type: "string" } },
        officialSourceFound: { type: "boolean" },
        discrepancies: {
          type: "array",
          items: {
            type: "object",
            properties: {
              field: { type: "string" },
              conflict: { type: "string" },
              resolution: { type: "string" },
            },
            required: ["field", "conflict", "resolution"],
          },
        },
      },
      required: ["confidenceScore", "sourcesUsed", "officialSourceFound", "discrepancies"],
    },
  },
  required: ["firmographics", "fundingHistory", "keyPersonnel", "synthesis", "dataQuality"],
};

// ---------------------------------------------------------------------------
// Phase 2: grok-3-mini synthesis via /v1/chat/completions (no web_search)
// ---------------------------------------------------------------------------

async function synthesizeWithGrok(
  systemPrompt: string,
  userContent: string,
): Promise<Partial<CompanyIntelligence>> {
  const res = await fetch(`${XAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${XAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "grok-4-1-fast-non-reasoning",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "CompanyIntelligence",
          schema: COMPANY_INTELLIGENCE_JSON_SCHEMA,
        },
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`xAI API error ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  const text = data.choices?.[0]?.message?.content ?? "{}";
  return JSON.parse(text) as Partial<CompanyIntelligence>;
}

// ---------------------------------------------------------------------------
// Helper: format Exa results for the synthesis prompt
// ---------------------------------------------------------------------------

function formatResults(results: ExaResult[], label: string): string {
  if (!results.length) return `[No ${label} results found]`;
  return results
    .map((r, i) => `[${label} ${i + 1}] ${r.title}\nURL: ${r.url}\n${r.text}`)
    .join("\n---\n");
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export const synthesizeCompanyProfile = async (
  query: string,
  location?: string,
): Promise<CompanyIntelligence> => {
  const locationHint = location ? ` located in ${location}` : "";
  const isDomain = query.includes(".");
  const subjectLine = isDomain
    ? `the company at domain "${query}"${location ? ` (${locationHint.trim()})` : ""}`
    : `the company named "${query}"${locationHint}`;

  if (isDev) console.log(`[Synthesis] Starting Exa+Grok synthesis for: ${subjectLine}`);

  // ---------------------------------------------------------------------------
  // Phase 1: 3 parallel Exa searches
  // ---------------------------------------------------------------------------
  const t1 = Date.now();

  const [profileResults, fundingResults, personnelResults] = await Promise.all([
    searchCompanyProfile(query, location),
    searchFundingHistory(query),
    searchKeyPersonnel(query),
  ]);

  if (isDev) console.log(`[Synthesis] Phase 1 — Exa search: ${Date.now() - t1}ms`);

  // ---------------------------------------------------------------------------
  // Phase 2: grok-3-mini structures the raw search results
  // ---------------------------------------------------------------------------
  const systemPrompt = `You are a firmographic data analyst. Extract structured company intelligence from the provided web search results.

Source Weighting (apply when data conflicts):
1. HIGHEST — Official company website
2. HIGH — LinkedIn company page
3. MEDIUM — Reputable news outlets (TechCrunch, Bloomberg, Reuters, Forbes)
4. LOW — Third-party aggregators (Crunchbase, PitchBook, ZoomInfo)

Confidence Score (0.0–1.0): 0.9+ = multiple strong sources agree; 0.7–0.9 = one strong source with minor gaps; <0.7 = sparse data.
sourcesUsed: List every source type that contributed (e.g. "Official Website", "LinkedIn").
officialSourceFound: true if any result URL is the company's own website.
synthesis: Write a 2–3 sentence executive summary of the company.
If a field cannot be determined from the search results, omit it or leave it empty.
Return ONLY valid JSON matching the schema.`;

  const userContent = `Research target: ${subjectLine}

=== COMPANY PROFILE SEARCH RESULTS ===
${formatResults(profileResults, "Profile")}

=== FUNDING HISTORY SEARCH RESULTS ===
${formatResults(fundingResults, "Funding")}

=== KEY PERSONNEL SEARCH RESULTS ===
${formatResults(personnelResults, "Personnel")}

Extract and structure the company intelligence from the above search results.`;

  const t2 = Date.now();
  const parsed = await synthesizeWithGrok(systemPrompt, userContent);
  if (isDev) console.log(`[Synthesis] Phase 2 — Grok synthesis: ${Date.now() - t2}ms`);
  if (isDev) console.log(`[Synthesis] Total: ${Date.now() - t1}ms`);

  const result: CompanyIntelligence = {
    firmographics: parsed.firmographics ?? { name: query, domain: isDomain ? query : "" },
    fundingHistory: parsed.fundingHistory ?? [],
    keyPersonnel: parsed.keyPersonnel ?? [],
    growthSignals: parsed.growthSignals,
    synthesis: parsed.synthesis ?? "",
    dataQuality: {
      confidenceScore: parsed.dataQuality?.confidenceScore ?? 0.5,
      sourcesUsed: parsed.dataQuality?.sourcesUsed ?? ["Web Search"],
      officialSourceFound: parsed.dataQuality?.officialSourceFound ?? false,
      discrepancies: parsed.dataQuality?.discrepancies ?? [],
    },
  };

  if (result.firmographics && !result.firmographics.domain && isDomain) {
    result.firmographics.domain = query;
  }

  return result;
};

/**
 * Resolves a plain company name to its canonical domain.
 * Fast path: Clearbit Autocomplete (~100ms).
 * Slow path: grok-4-1-fast-non-reasoning via chat completions.
 */
export const resolveCompanyDomain = async (
  query: string,
  location?: string,
): Promise<string> => {
  let clearbitHint: string | null = null;

  // 1. Fast Path: Clearbit Autocomplete
  try {
    const clearbitRes = await fetch(
      `https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(query)}`,
    );
    if (clearbitRes.ok) {
      const data = (await clearbitRes.json()) as Array<{ name?: string; domain: string }>;
      if (data && data.length > 0 && data[0].domain) {
        // Validate: only trust if the domain base OR company name exactly matches the query
        const domainBase = data[0].domain.split(".")[0].toLowerCase().replace(/\W/g, "");
        const nameNorm = (data[0].name ?? "").toLowerCase().replace(/\W/g, "");
        const queryNorm = query.trim().toLowerCase().replace(/\W/g, "");
        if (domainBase === queryNorm || nameNorm === queryNorm) {
          return data[0].domain; // confident match — fast path
        }
        // Clearbit returned a different company; pass it to Grok as a hint
        clearbitHint = data[0].domain;
        if (isDev) console.log(`[Clearbit] Candidate "${clearbitHint}" doesn't match "${query}" — falling back to Grok`);
      }
    }
  } catch (err) {
    console.warn(`[Clearbit] Failed for "${query}", falling back to Grok...`, err);
  }

  // 2. Slow Path: grok-4-1-fast-non-reasoning
  const locationHint = location ? ` located in ${location}` : "";
  const hintLine = clearbitHint
    ? `Note: An autocomplete API suggested "${clearbitHint}" but this may be a different company.`
    : "";
  const prompt = `You are a firmographic data analyst.
Task: Return the official website domain for the company "${query}"${locationHint}.
${hintLine}

Rules:
- Return ONLY the bare domain (e.g. "stripe.com"). No protocol, no www, no path.
- If the query is a product name (e.g. "jira"), return the parent company domain (e.g. "atlassian.com").
- If no website exists, return the company name in lowercase with no spaces.`;

  try {
    const res = await fetch(`${XAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${XAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "grok-4-1-fast-non-reasoning",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
      }),
    });

    if (!res.ok) throw new Error(`xAI ${res.status}`);

    const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    const rawResult = (data.choices?.[0]?.message?.content ?? "").trim().toLowerCase();
    const fallback = query.trim().toLowerCase();

    if (!rawResult || rawResult === "null") return fallback;

    let finalResult = rawResult;
    finalResult = finalResult.replace(/^https?:\/\//, "");
    finalResult = finalResult.replace(/^www\./, "");
    finalResult = finalResult.replace(/\/.*$/, "");
    finalResult = finalResult.split(/\s/)[0]; // take first word only

    return finalResult || fallback;
  } catch (e) {
    console.error(`[Domain Resolution] Failed for "${query}":`, e);
    return query.trim().toLowerCase();
  }
};
