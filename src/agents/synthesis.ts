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
      required: [
        "confidenceScore",
        "sourcesUsed",
        "officialSourceFound",
        "discrepancies",
      ],
    },
  },
  required: [
    "firmographics",
    "fundingHistory",
    "keyPersonnel",
    "synthesis",
    "dataQuality",
  ],
};

// ---------------------------------------------------------------------------
// Phase 2: synthesis via Responses API with web_search for gap-filling
// ---------------------------------------------------------------------------

async function synthesizeWithGrok(
  systemPrompt: string,
  userContent: string,
): Promise<Partial<CompanyIntelligence>> {
  const res = await fetch(`${XAI_BASE_URL}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${XAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "grok-4-1-fast-non-reasoning",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      tools: [{ type: "web_search" }],
      text: {
        format: {
          type: "json_schema",
          name: "CompanyIntelligence",
          schema: COMPANY_INTELLIGENCE_JSON_SCHEMA,
          strict: true,
        },
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`xAI API error ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    output?: Array<{
      type: string;
      content?: Array<{ type: string; text?: string }>;
    }>;
  };

  const text =
    data.output
      ?.filter((item) => item.type === "message")
      ?.flatMap((item) => item.content ?? [])
      ?.filter((c) => c.type === "output_text")
      ?.map((c) => c.text ?? "")
      ?.join("") ?? "{}";

  return JSON.parse(text) as Partial<CompanyIntelligence>;
}

// ---------------------------------------------------------------------------
// Helper: format Exa results for the synthesis prompt
// ---------------------------------------------------------------------------

function formatResults(results: ExaResult[], label: string): string {
  if (!results.length)
    return `[No ${label} results found — treat any data from other sections for this topic as lower confidence]`;
  return results
    .map(
      (r, i) =>
        `[${label} ${i + 1}]\nSOURCE: ${r.url}\nTITLE: ${r.title}\nCONTENT:\n${r.text}`,
    )
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

  if (isDev)
    console.log(`[Synthesis] Starting Exa+Grok synthesis for: ${subjectLine}`);

  // ---------------------------------------------------------------------------
  // Phase 1: 3 parallel Exa searches
  // ---------------------------------------------------------------------------
  const t1 = Date.now();

  const [profileResults, fundingResults, personnelResults] = await Promise.all([
    searchCompanyProfile(query, location),
    searchFundingHistory(query),
    searchKeyPersonnel(query),
  ]);

  if (isDev)
    console.log(`[Synthesis] Phase 1 — Exa search: ${Date.now() - t1}ms`);

  // ---------------------------------------------------------------------------
  // Phase 2: grok-3-mini structures the raw search results
  // ---------------------------------------------------------------------------
  const systemPrompt = `You are a firmographic data analyst. The search results below were retrieved from Exa, a neural web search engine. Each result includes a source URL, title, and extracted page text. Your job is to synthesise these into structured company intelligence.

SOURCE RELIABILITY — use the URL domain to assign each result a tier before extracting data:
  Tier 1 (HIGHEST): The company's own website (domain matches the company being researched), official press releases on company domain
  Tier 2 (HIGH):    LinkedIn company page (linkedin.com/company/...), regulatory filings (sec.gov, companieshouse.gov.uk)
  Tier 3 (MEDIUM):  Reputable business media — TechCrunch, Bloomberg, Reuters, Forbes, WSJ, CNBC, The Information; Crunchbase / PitchBook (reliable for funding rounds, treat headcount as estimates)
  Tier 4 (LOW):     Unknown blogs, content farms, aggregators, ZoomInfo, Hoovers, Wikipedia (use only for founding year / basic facts)

When sources conflict, always prefer the higher-tier source and log the conflict in dataQuality.discrepancies.

CONFIDENCE SCORE RULES (0.0–1.0):
  0.9–1.0  → Tier 1 source confirms key fields, OR two or more Tier 2 sources agree
  0.7–0.89 → Single Tier 2 source, OR multiple consistent Tier 3 sources
  0.5–0.69 → Only Tier 3–4 sources, or data is partial / sparse
  <0.5     → Very few results, no recognisable sources, or significant unresolved conflicts

MANDATORY FIELDS — these MUST be populated in every response, no exceptions:
  synthesis:
    Always write 2–3 sentences covering (1) what the company does, (2) its scale or stage, (3) any notable recent context (funding, acquisition, product launch). If data is sparse, write what you can confirm and acknowledge the uncertainty inline (e.g. "Limited public data is available, but…").

  dataQuality.confidenceScore:
    Always a number between 0.0 and 1.0. Never omit or null.

  dataQuality.sourcesUsed:
    Always list every source domain or type that contributed data, e.g. ["stripe.com (Official)", "LinkedIn", "TechCrunch"]. Never return an empty array unless you received zero search results.

  dataQuality.officialSourceFound:
    true if any result URL belongs to the company's own domain. false otherwise. Never omit.

  dataQuality.discrepancies:
    List every field where two or more sources disagreed, how you resolved it, and which source you trusted. Return [] only if there are genuinely no conflicts.

For any other field that cannot be determined from the search results, omit it or leave it null — do NOT fabricate data.

OUTPUT HYGIENE:
Never mention internal tool names (Exa, web_search, etc.) anywhere in the JSON output — not in sourcesUsed, not in discrepancy descriptions, nowhere. Reference only the actual source (e.g. "LinkedIn", "TechCrunch", "braudit.app (Official)").

WEB SEARCH GUIDANCE:
You have access to web_search. Use it sparingly — only to fill fields that are genuinely absent or ambiguous in the Exa results above. Do NOT re-search for information already present in the Exa sections. Good candidates: an executive name that appears truncated, a funding amount missing from all three sources, or a headquarters city not mentioned anywhere.

Return ONLY valid JSON matching the schema.`;

  const userContent = `Research target: ${subjectLine}

=== COMPANY PROFILE SEARCH RESULTS (Exa) ===
${formatResults(profileResults, "Profile")}

=== FUNDING HISTORY SEARCH RESULTS (Exa) ===
${formatResults(fundingResults, "Funding")}

=== KEY PERSONNEL SEARCH RESULTS (Exa) ===
${formatResults(personnelResults, "Personnel")}

Extract and structure the company intelligence from the above search results. Use web_search only for fields not covered by the Exa sections above.`;

  const t2 = Date.now();
  const parsed = await synthesizeWithGrok(systemPrompt, userContent);
  if (isDev)
    console.log(`[Synthesis] Phase 2 — Grok synthesis: ${Date.now() - t2}ms`);
  if (isDev) console.log(`[Synthesis] Total: ${Date.now() - t1}ms`);

  const result: CompanyIntelligence = {
    firmographics: parsed.firmographics ?? {
      name: query,
      domain: isDomain ? query : "",
    },
    fundingHistory: parsed.fundingHistory ?? [],
    keyPersonnel: parsed.keyPersonnel ?? [],
    growthSignals: parsed.growthSignals,
    synthesis:
      parsed.synthesis && parsed.synthesis.trim().length > 0
        ? parsed.synthesis
        : `${parsed.firmographics?.name ?? query} is a company for which limited public data was found at query time. Confidence in the returned fields is low — verify directly with the company or an authoritative business database.`,
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
      const data = (await clearbitRes.json()) as Array<{
        name?: string;
        domain: string;
      }>;
      if (data && data.length > 0 && data[0].domain) {
        // Validate: only trust if the domain base OR company name exactly matches the query
        const domainBase = data[0].domain
          .split(".")[0]
          .toLowerCase()
          .replace(/\W/g, "");
        const nameNorm = (data[0].name ?? "").toLowerCase().replace(/\W/g, "");
        const queryNorm = query.trim().toLowerCase().replace(/\W/g, "");
        if (domainBase === queryNorm || nameNorm === queryNorm) {
          return data[0].domain; // confident match — fast path
        }
        // Clearbit returned a different company; pass it to Grok as a hint
        clearbitHint = data[0].domain;
        if (isDev)
          console.log(
            `[Clearbit] Candidate "${clearbitHint}" doesn't match "${query}" — falling back to Grok`,
          );
      }
    }
  } catch (err) {
    console.warn(
      `[Clearbit] Failed for "${query}", falling back to Grok...`,
      err,
    );
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

    const data = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    const rawResult = (data.choices?.[0]?.message?.content ?? "")
      .trim()
      .toLowerCase();
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
