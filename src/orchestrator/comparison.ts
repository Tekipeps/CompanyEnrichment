import { enrichCompany } from "./enrichment.js";
import { logger } from "../utils/logger.js";
import type {
  CompanyQuery,
  CompanyResult,
  CompareCompaniesOutput,
  Comparison,
  CompanyIntelligence,
} from "../types/index.js";

const XAI_BASE_URL = "https://api.x.ai/v1";
const XAI_API_KEY = process.env.XAI_API_KEY ?? "";

// ---------------------------------------------------------------------------
// Internal working type — full intelligence kept here, not in the output
// ---------------------------------------------------------------------------

type EnrichedCompany = {
  query: string;
  key: string;   // deduped display name
  intel: CompanyIntelligence;
};

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/** Extract the first integer from a free-form headcount string. */
function parseHeadcountNumber(estimate: string | undefined): number | null {
  if (!estimate) return null;
  const normalised = estimate
    .replace(/(\d+(?:\.\d+)?)\s*[kK]/g, (_, n) => String(Math.round(parseFloat(n) * 1_000)))
    .replace(/(\d+(?:\.\d+)?)\s*[mM]/g, (_, n) => String(Math.round(parseFloat(n) * 1_000_000)));
  const match = normalised.match(/[\d,]+/);
  if (!match) return null;
  const parsed = parseInt(match[0].replace(/,/g, ""), 10);
  return isNaN(parsed) ? null : parsed;
}

/** Parse a funding round date string → timestamp for sorting. Returns 0 on failure. */
function parseRoundDate(dateStr: string | undefined): number {
  if (!dateStr) return 0;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

/** Format the chronologically latest funding round as a readable string. */
function latestRoundLabel(intel: CompanyIntelligence): string {
  const rounds = intel.fundingHistory;
  if (!rounds || rounds.length === 0) return "unknown";
  const sorted = [...rounds].sort((a, b) => parseRoundDate(b.date) - parseRoundDate(a.date));
  const latest = sorted[0];
  const parts: string[] = [];
  if (latest.roundType) parts.push(latest.roundType);
  if (latest.amount) parts.push(latest.amount);
  if (latest.date) parts.push(`(${latest.date})`);
  return parts.length > 0 ? parts.join(" · ") : "unknown";
}

/** Find a person in keyPersonnel by title keywords (case-insensitive). */
function findPerson(intel: CompanyIntelligence, ...keywords: string[]): string | null {
  const found = (intel.keyPersonnel ?? []).find((p) =>
    keywords.some((kw) => p.title.toLowerCase().includes(kw.toLowerCase())),
  );
  return found?.name ?? null;
}

/** Deduplicate display name when two companies resolve to the same name. */
function buildKeys(enriched: EnrichedCompany[], all: Array<{ query: string; key: string }>): string[] {
  return all.map((item, i) => {
    const duplicates = all.filter((r, j) => j !== i && r.key === item.key);
    return duplicates.length > 0 ? `${item.key} (${i + 1})` : item.key;
  });
}

// ---------------------------------------------------------------------------
// Diff builders — each returns one field of ComparisonSchema
// ---------------------------------------------------------------------------

function buildFundingComparison(enriched: EnrichedCompany[]): Comparison["funding"] {
  const totalRoundsByCompany: Record<string, number> = {};
  const latestRoundByCompany: Record<string, string> = {};

  enriched.forEach(({ key, intel }) => {
    totalRoundsByCompany[key] = intel.fundingHistory?.length ?? 0;
    latestRoundByCompany[key] = latestRoundLabel(intel);
  });

  const ranked = [...enriched].sort(
    (a, b) => (totalRoundsByCompany[b.key] ?? 0) - (totalRoundsByCompany[a.key] ?? 0),
  );

  const notes: string[] = [];
  if (enriched.length === 2) {
    const [a, b] = ranked;
    const diff = (totalRoundsByCompany[a.key] ?? 0) - (totalRoundsByCompany[b.key] ?? 0);
    if (diff >= 2) {
      notes.push(
        `${a.key} has ${totalRoundsByCompany[a.key]} known funding rounds vs ${b.key}'s ${totalRoundsByCompany[b.key]}.`,
      );
    }
  }

  return {
    rankedByRoundCount: ranked.map((e) => e.key),
    totalRoundsByCompany,
    latestRoundByCompany,
    notes: notes.length > 0 ? notes : undefined,
  };
}

function buildHeadcountComparison(enriched: EnrichedCompany[]): Comparison["headcount"] {
  type Trend = "growing" | "stable" | "declining" | "unknown" | "insufficient_data";
  const estimateByCompany: Record<string, string | null> = {};
  const trendByCompany: Record<string, Trend> = {};
  const changePercentByCompany: Record<string, number | null> = {};

  enriched.forEach(({ key, intel }) => {
    estimateByCompany[key] = intel.firmographics.employeeCountEstimate ?? null;

    const history = intel.headcountHistory;
    if (!history || history.length < 2) {
      trendByCompany[key] = "insufficient_data";
      changePercentByCompany[key] = null;
      return;
    }
    const oldest = parseHeadcountNumber(history[0].estimate);
    const newest = parseHeadcountNumber(history[history.length - 1].estimate);
    if (oldest === null || newest === null || oldest === 0) {
      trendByCompany[key] = "unknown";
      changePercentByCompany[key] = null;
      return;
    }
    const pct = ((newest - oldest) / oldest) * 100;
    changePercentByCompany[key] = Math.round(pct * 10) / 10;
    trendByCompany[key] = pct > 10 ? "growing" : pct < -10 ? "declining" : "stable";
  });

  const sorted = [...enriched].sort((a, b) => {
    const aVal = parseHeadcountNumber(estimateByCompany[a.key] ?? undefined);
    const bVal = parseHeadcountNumber(estimateByCompany[b.key] ?? undefined);
    if (aVal === null && bVal === null) return 0;
    if (aVal === null) return 1;
    if (bVal === null) return -1;
    return bVal - aVal;
  });

  const notes: string[] = [];
  if (enriched.length === 2) {
    const [big, small] = sorted;
    const bVal = parseHeadcountNumber(estimateByCompany[big.key] ?? undefined);
    const sVal = parseHeadcountNumber(estimateByCompany[small.key] ?? undefined);
    if (bVal !== null && sVal !== null && sVal > 0) {
      const ratio = bVal / sVal;
      if (ratio >= 2) {
        notes.push(`${big.key} is roughly ${Math.round(ratio)}x larger than ${small.key} by headcount estimate.`);
      }
    }
  }

  return {
    rankedByEstimate: sorted.map((e) => e.key),
    estimateByCompany,
    trendByCompany,
    changePercentByCompany,
    notes: notes.length > 0 ? notes : undefined,
  };
}

function buildHiringComparison(enriched: EnrichedCompany[]): Comparison["hiring"] {
  type HiringTrend = "growing" | "stable" | "declining" | "unknown";
  const currentCountByCompany: Record<string, number | null> = {};
  const cappedByCompany: Record<string, boolean> = {};
  const trendByCompany: Record<string, HiringTrend> = {};

  enriched.forEach(({ key, intel }) => {
    const jv = intel.jobPostingVelocity;
    currentCountByCompany[key] = jv?.currentCount ?? null;
    cappedByCompany[key] = jv?.capped ?? false;
    trendByCompany[key] = (jv?.trend ?? "unknown") as HiringTrend;
  });

  const sorted = [...enriched].sort((a, b) => {
    const aCount = currentCountByCompany[a.key] ?? -1;
    const bCount = currentCountByCompany[b.key] ?? -1;
    return bCount - aCount;
  });

  const notes: string[] = [];
  if (enriched.length === 2) {
    const [top, bottom] = sorted;
    const topCount = currentCountByCompany[top.key];
    const botCount = currentCountByCompany[bottom.key];
    if (topCount !== null && botCount !== null && topCount - botCount >= 5) {
      const cappedNote = cappedByCompany[top.key] ? "+" : "";
      notes.push(`${top.key} has ${topCount}${cappedNote} open roles vs ${bottom.key}'s ${botCount}${cappedByCompany[bottom.key] ? "+" : ""}.`);
    }
  }

  return {
    rankedByJobPostingCount: sorted.map((e) => e.key),
    currentCountByCompany,
    cappedByCompany,
    trendByCompany,
    notes: notes.length > 0 ? notes : undefined,
  };
}

function buildSearchInterestComparison(
  enriched: EnrichedCompany[],
): Comparison["searchInterest"] {
  type SearchTrend = "growing" | "stable" | "declining" | "unknown";
  const currentScoreByCompany: Record<string, number | null> = {};
  const recentAverageByCompany: Record<string, number | null> = {};
  const changePercentByCompany: Record<string, number | null> = {};
  const trendByCompany: Record<string, SearchTrend> = {};

  enriched.forEach(({ key, intel }) => {
    currentScoreByCompany[key] = intel.searchInterest?.currentScore ?? null;
    recentAverageByCompany[key] = intel.searchInterest?.recentAverage ?? null;
    changePercentByCompany[key] = intel.searchInterest?.changePercent ?? null;
    trendByCompany[key] = (intel.searchInterest?.trend ?? "unknown") as SearchTrend;
  });

  const byCurrent = [...enriched].sort((a, b) => {
    const aScore = currentScoreByCompany[a.key] ?? -1;
    const bScore = currentScoreByCompany[b.key] ?? -1;
    return bScore - aScore;
  });
  const byMomentum = [...enriched].sort((a, b) => {
    const aScore = changePercentByCompany[a.key] ?? Number.NEGATIVE_INFINITY;
    const bScore = changePercentByCompany[b.key] ?? Number.NEGATIVE_INFINITY;
    return bScore - aScore;
  });

  const notes: string[] = [];
  if (enriched.length === 2) {
    const [leader, follower] = byMomentum;
    const leaderChange = changePercentByCompany[leader.key];
    const followerChange = changePercentByCompany[follower.key];
    if (
      leaderChange !== null &&
      followerChange !== null &&
      leaderChange - followerChange >= 10
    ) {
      notes.push(
        `${leader.key} shows stronger Google search momentum (${leaderChange}% vs ${follower.key}'s ${followerChange}%).`,
      );
    }
  }

  return {
    rankedByCurrentScore: byCurrent.map((item) => item.key),
    rankedByMomentum: byMomentum.map((item) => item.key),
    currentScoreByCompany,
    recentAverageByCompany,
    changePercentByCompany,
    trendByCompany,
    notes: notes.length > 0 ? notes : undefined,
  };
}

function buildAgeComparison(enriched: EnrichedCompany[]): Comparison["age"] {
  const foundedYearByCompany: Record<string, number | null> = {};
  enriched.forEach(({ key, intel }) => {
    foundedYearByCompany[key] = intel.firmographics.foundedYear ?? null;
  });

  const sorted = [...enriched].sort((a, b) => {
    const aYear = foundedYearByCompany[a.key];
    const bYear = foundedYearByCompany[b.key];
    if (aYear === null && bYear === null) return 0;
    if (aYear === null) return 1;
    if (bYear === null) return -1;
    return aYear - bYear; // oldest first
  });

  return {
    rankedByAge: sorted.map((e) => e.key),
    foundedYearByCompany,
  };
}

function buildIndustryOverlap(enriched: EnrichedCompany[]): Comparison["industryOverlap"] {
  const byCompany: Record<string, string | null> = {};
  enriched.forEach(({ key, intel }) => {
    byCompany[key] = intel.firmographics.industry ?? null;
  });
  const allIndustries = [...new Set(Object.values(byCompany).filter((v): v is string => v !== null))];
  return { allIndustries, byCompany, shareIndustry: allIndustries.length === 1 };
}

function buildHeadquartersComparison(enriched: EnrichedCompany[]): Comparison["headquarters"] {
  const byCompany: Record<string, string | null> = {};
  enriched.forEach(({ key, intel }) => {
    byCompany[key] = intel.firmographics.headquarters ?? null;
  });

  const cities = Object.values(byCompany).filter(Boolean);
  const sameCity = cities.length === enriched.length && new Set(cities).size === 1;

  return { byCompany, sameCity };
}

function buildLeadershipComparison(enriched: EnrichedCompany[]): Comparison["leadership"] {
  const ceoByCompany: Record<string, string | null> = {};
  const ctoByCompany: Record<string, string | null> = {};
  const foundersByCompany: Record<string, string[]> = {};

  enriched.forEach(({ key, intel }) => {
    ceoByCompany[key] = findPerson(intel, "CEO", "Chief Executive");
    ctoByCompany[key] = findPerson(intel, "CTO", "Chief Technology");
    foundersByCompany[key] = (intel.keyPersonnel ?? [])
      .filter((p) => p.title.toLowerCase().includes("founder"))
      .map((p) => `${p.name} (${p.title})`);
  });

  return { ceoByCompany, ctoByCompany, foundersByCompany };
}

function buildGrowthSignalsComparison(enriched: EnrichedCompany[]): Comparison["growthSignals"] {
  const hiringVelocityByCompany: Record<string, string | null> = {};
  const fundingSignalsByCompany: Record<string, string | null> = {};
  const generalSignalsByCompany: Record<string, string[]> = {};

  enriched.forEach(({ key, intel }) => {
    const gs = intel.growthSignals;
    hiringVelocityByCompany[key] = gs?.hiringVelocity ?? null;
    fundingSignalsByCompany[key] = gs?.fundingSignals ?? null;
    generalSignalsByCompany[key] = gs?.generalSignals ?? [];
  });

  return { hiringVelocityByCompany, fundingSignalsByCompany, generalSignalsByCompany };
}

function buildSpecialtiesComparison(enriched: EnrichedCompany[]): Comparison["specialties"] {
  const byCompany: Record<string, string[]> = {};
  enriched.forEach(({ key, intel }) => {
    byCompany[key] = intel.firmographics.specialties ?? [];
  });

  const allArrays = Object.values(byCompany);
  const firstNorm = (allArrays[0] ?? []).map((s) => s.toLowerCase());
  const secondNorm = (allArrays[1] ?? []).map((s) => s.toLowerCase());
  const sharedNorm = firstNorm.filter((s) => secondNorm.includes(s));
  const sharedSpecialties = (allArrays[0] ?? []).filter((s) => sharedNorm.includes(s.toLowerCase()));

  const uniqueToEach: Record<string, string[]> = {};
  enriched.forEach(({ key, intel }) => {
    const ownSpecialties = intel.firmographics.specialties ?? [];
    const otherNorm = Object.entries(byCompany)
      .filter(([k]) => k !== key)
      .flatMap(([, v]) => v.map((s) => s.toLowerCase()));
    uniqueToEach[key] = ownSpecialties.filter((s) => !otherNorm.includes(s.toLowerCase()));
  });

  return { byCompany, sharedSpecialties, uniqueToEach };
}

function buildDataQualityComparison(enriched: EnrichedCompany[]): Comparison["dataQuality"] {
  const confidenceScoreByCompany: Record<string, number> = {};
  const sourcesUsedByCompany: Record<string, string[]> = {};

  enriched.forEach(({ key, intel }) => {
    confidenceScoreByCompany[key] = intel.dataQuality.confidenceScore;
    sourcesUsedByCompany[key] = intel.dataQuality.sourcesUsed;
  });

  return { confidenceScoreByCompany, sourcesUsedByCompany };
}

function buildDiff(enriched: EnrichedCompany[]): Comparison {
  return {
    funding: buildFundingComparison(enriched),
    headcount: buildHeadcountComparison(enriched),
    hiring: buildHiringComparison(enriched),
    searchInterest: buildSearchInterestComparison(enriched),
    age: buildAgeComparison(enriched),
    industryOverlap: buildIndustryOverlap(enriched),
    headquarters: buildHeadquartersComparison(enriched),
    leadership: buildLeadershipComparison(enriched),
    growthSignals: buildGrowthSignalsComparison(enriched),
    specialties: buildSpecialtiesComparison(enriched),
    dataQuality: buildDataQualityComparison(enriched),
  };
}

// ---------------------------------------------------------------------------
// Empty comparison — schema-valid zero state for error responses
// ---------------------------------------------------------------------------

function emptyComparison(): Comparison {
  return {
    funding: { rankedByRoundCount: [], totalRoundsByCompany: {}, latestRoundByCompany: {} },
    headcount: { rankedByEstimate: [], estimateByCompany: {}, trendByCompany: {}, changePercentByCompany: {} },
    hiring: { rankedByJobPostingCount: [], currentCountByCompany: {}, cappedByCompany: {}, trendByCompany: {} },
    searchInterest: {
      rankedByCurrentScore: [],
      rankedByMomentum: [],
      currentScoreByCompany: {},
      recentAverageByCompany: {},
      changePercentByCompany: {},
      trendByCompany: {},
    },
    age: { rankedByAge: [], foundedYearByCompany: {} },
    industryOverlap: { allIndustries: [], byCompany: {}, shareIndustry: false },
    headquarters: { byCompany: {}, sameCity: false },
    leadership: { ceoByCompany: {}, ctoByCompany: {}, foundersByCompany: {} },
    growthSignals: { hiringVelocityByCompany: {}, fundingSignalsByCompany: {}, generalSignalsByCompany: {} },
    specialties: { byCompany: {}, sharedSpecialties: [], uniqueToEach: {} },
    dataQuality: { confidenceScoreByCompany: {}, sourcesUsedByCompany: {} },
  };
}

// ---------------------------------------------------------------------------
// Grok narrative synthesis
// ---------------------------------------------------------------------------

function buildNarrativePrompt(enriched: EnrichedCompany[], failed: string[], diff: Comparison): string {
  const summaries = enriched
    .map(({ key, intel }) => {
      const f = intel.firmographics;
      const jv = intel.jobPostingVelocity;
      return [
        `[${key}]`,
        `Domain: ${f.domain} | Industry: ${f.industry ?? "unknown"} | Founded: ${f.foundedYear ?? "unknown"}`,
        `Headcount: ${f.employeeCountEstimate ?? "unknown"} | HQ: ${f.headquarters ?? "unknown"}`,
        `Synthesis: "${intel.synthesis}"`,
        jv
          ? `Hiring: ${jv.currentCount}${jv.capped ? "+" : ""} open roles (${jv.trend})`
          : "Hiring: unknown",
        `Confidence: ${intel.dataQuality.confidenceScore}`,
      ].join("\n");
    })
    .join("\n\n");

  const failedNote = failed.length > 0
    ? `\nFailed to enrich: ${failed.join(", ")} — do not speculate about these.\n`
    : "";

  const keys = enriched.map((e) => e.key);
  const diffLines = [
    `Funding rounds: ${diff.funding.rankedByRoundCount.map((k) => `${k} (${diff.funding.totalRoundsByCompany[k]})`).join(" > ")}`,
    `Latest round: ${Object.entries(diff.funding.latestRoundByCompany).map(([k, v]) => `${k}: ${v}`).join(" | ")}`,
    `Headcount: ${diff.headcount.rankedByEstimate.map((k) => `${k} (${diff.headcount.estimateByCompany[k] ?? "unknown"})`).join(" > ")}`,
    `Headcount trend: ${Object.entries(diff.headcount.trendByCompany).map(([k, v]) => `${k}: ${v}`).join(" | ")}`,
    `Hiring: ${diff.hiring.rankedByJobPostingCount.map((k) => `${k} (${diff.hiring.currentCountByCompany[k] ?? "?"}${diff.hiring.cappedByCompany[k] ? "+" : ""})`).join(" > ")}`,
    `Search interest: ${diff.searchInterest.rankedByCurrentScore.map((k) => `${k} (${diff.searchInterest.currentScoreByCompany[k] ?? "?"})`).join(" > ")}`,
    `Search momentum: ${Object.entries(diff.searchInterest.changePercentByCompany).map(([k, v]) => `${k}: ${v ?? "unknown"}%`).join(" | ")}`,
    `CEO: ${Object.entries(diff.leadership.ceoByCompany).map(([k, v]) => `${k}: ${v ?? "unknown"}`).join(" | ")}`,
    `Founded: ${Object.entries(diff.age.foundedYearByCompany).map(([k, v]) => `${k}: ${v ?? "unknown"}`).join(" | ")}`,
    `HQ: ${Object.entries(diff.headquarters.byCompany).map(([k, v]) => `${k}: ${v ?? "unknown"}`).join(" | ")}`,
    `Industry: ${diff.industryOverlap.shareIndustry ? `Both in ${diff.industryOverlap.allIndustries[0] ?? "same industry"}` : Object.entries(diff.industryOverlap.byCompany).map(([k, v]) => `${k}: ${v ?? "unknown"}`).join(" | ")}`,
  ];

  return `Companies: ${keys.join(" vs ")}${failedNote}

=== ENRICHMENT SUMMARIES ===
${summaries}

=== STRUCTURED DIFF ===
${diffLines.join("\n")}`;
}

function deterministicFallbackNarrative(enriched: EnrichedCompany[], diff: Comparison): string {
  const [a, b] = enriched.map((e) => e.key);
  const fundingLeader = diff.funding.rankedByRoundCount[0] ?? a;
  const hiringLeader = diff.hiring.rankedByJobPostingCount[0] ?? a;
  const searchLeader = diff.searchInterest.rankedByMomentum[0] ?? a;
  const oldest = diff.age.rankedByAge[0] ?? a;
  const oldestYear = diff.age.foundedYearByCompany[oldest];
  const industryNote = diff.industryOverlap.shareIndustry
    ? `Both operate in ${diff.industryOverlap.allIndustries[0] ?? "the same industry"}.`
    : `${a} is in ${diff.industryOverlap.byCompany[a] ?? "an unknown industry"} while ${b} is in ${diff.industryOverlap.byCompany[b] ?? "an unknown industry"}.`;
  const hiringCount = diff.hiring.currentCountByCompany[hiringLeader];
  const hiringStr = hiringCount !== null ? `${hiringCount}${diff.hiring.cappedByCompany[hiringLeader] ? "+" : ""} open roles` : "more active hiring signals";
  const searchDelta = diff.searchInterest.changePercentByCompany[searchLeader];
  const searchNote =
    searchDelta !== null
      ? `${searchLeader} also shows stronger recent search momentum at ${searchDelta}%.`
      : "";
  return `${a} and ${b} can be compared across the available company signals. ${industryNote} ${fundingLeader} leads on total known funding rounds. ${hiringLeader} shows ${hiringStr}. ${searchNote} ${oldest} is the older company${oldestYear ? `, founded in ${oldestYear}` : ""}.`.trim();
}

async function synthesizeNarrative(
  enriched: EnrichedCompany[],
  failed: string[],
  diff: Comparison,
): Promise<string> {
  try {
    const res = await fetch(`${XAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${XAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "grok-4-1-fast-non-reasoning",
        messages: [
          {
            role: "system",
            content:
              "You are a senior business analyst writing a concise executive comparison. Write 3–5 sentences of flowing prose — no bullet points, no headers. Cover: (1) the most meaningful difference in scale or stage, (2) any notable growth or hiring signals, (3) which company is in a stronger competitive position and why. Do not hallucinate. Acknowledge data gaps rather than guessing.",
          },
          {
            role: "user",
            content: buildNarrativePrompt(enriched, failed, diff),
          },
        ],
        temperature: 0.3,
        max_tokens: 350,
      }),
    });

    if (!res.ok) throw new Error(`xAI ${res.status}`);
    const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    const text = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) throw new Error("Empty response");
    return text;
  } catch (err) {
    logger.error("[Comparison] Grok narrative failed, using fallback", {
      error: err instanceof Error ? err.message : String(err),
    });
    return deterministicFallbackNarrative(enriched, diff);
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function compareCompanies(
  companies: CompanyQuery[],
): Promise<CompareCompaniesOutput> {
  const startMs = Date.now();
  logger.info(`[Comparison] Starting: ${companies.map((c) => c.query).join(" vs ")}`);

  const settled = await Promise.allSettled(
    companies.map((c) => enrichCompany(c.query, c.location)),
  );

  // Build enriched list and slim results in one pass
  const enrichedList: EnrichedCompany[] = [];
  const failedQueries: string[] = [];
  const results: CompanyResult[] = settled.map((s, i) => {
    const query = companies[i].query;
    if (s.status === "fulfilled") {
      const rawKey = s.value.firmographics?.name ?? query;
      enrichedList.push({ query, key: rawKey, intel: s.value });
      return {
        query,
        succeeded: true,
        resolvedName: s.value.firmographics?.name,
        resolvedDomain: s.value.firmographics?.domain,
      };
    }
    const msg = s.reason instanceof Error ? s.reason.message : String(s.reason);
    logger.error(`[Comparison] Enrichment failed for ${query}: ${msg}`);
    failedQueries.push(query);
    return { query, succeeded: false, error: msg };
  });

  // Deduplicate display keys after all enrichments are done
  const deduped = buildKeys(
    enrichedList,
    enrichedList.map((e) => ({ query: e.query, key: e.key })),
  );
  enrichedList.forEach((e, i) => { e.key = deduped[i]; });

  const durationMs = Date.now() - startMs;
  const baseMeta = {
    requestedCount: companies.length,
    succeededCount: enrichedList.length,
    failedCount: failedQueries.length,
    partialResult: failedQueries.length > 0,
    durationMs,
  };

  if (enrichedList.length < 2) {
    const narrative =
      enrichedList.length === 0
        ? "No companies could be enriched. Comparison is unavailable."
        : `Only ${enrichedList[0].key} was enriched successfully. A comparison requires at least 2 companies.`;
    return { companies: results, comparison: emptyComparison(), narrative, meta: { ...baseMeta, partialResult: true } };
  }

  const diff = buildDiff(enrichedList);
  const narrative = await synthesizeNarrative(enrichedList, failedQueries, diff);

  logger.info(
    `[Comparison] Complete for ${enrichedList.map((e) => e.key).join(" vs ")} in ${durationMs}ms`,
  );

  return { companies: results, comparison: diff, narrative, meta: baseMeta };
}
