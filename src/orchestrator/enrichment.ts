import {
  getCachedCompanyData,
  saveCompanyData,
  saveSnapshot,
  getSnapshotHistory,
  type SnapshotRow,
} from "../services/db.js";
import {
  synthesizeCompanyProfile,
  resolveCompanyDomain,
} from "../agents/synthesis.js";
import { JOB_POSTING_LIMIT } from "../data/exa.js";
import type { CompanyIntelligence } from "../types/index.js";

const isDev = process.env.NODE_ENV !== "production";

// 7 days — minimum gap between snapshot saves for the same domain
const SNAPSHOT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

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

// ---------------------------------------------------------------------------
// Trend computation helpers
// ---------------------------------------------------------------------------

function buildHeadcountHistory(
  snapshots: SnapshotRow[],
): Array<{ date: string; estimate: string }> {
  return snapshots
    .filter((s) => s.headcount)
    .reverse() // oldest first
    .map((s) => ({
      date: s.snapshotDate.toISOString().split("T")[0],
      estimate: s.headcount!,
    }));
}

function buildJobPostingVelocity(snapshots: SnapshotRow[]): {
  currentCount: number;
  capped?: boolean;
  previousCount?: number;
  changePercent?: number;
  trend: "growing" | "stable" | "declining" | "unknown";
  asOf: string;
} | undefined {
  const withCount = snapshots.filter((s) => s.jobPostingCount !== null);
  if (withCount.length === 0) return undefined;

  const latest = withCount[0]; // newest (snapshots are desc-sorted)
  const currentCount = latest.jobPostingCount!;
  const asOf = latest.snapshotDate.toISOString().split("T")[0];

  // Find a baseline snapshot older than 14 days
  const baseline = withCount.find(
    (s) =>
      Date.now() - s.snapshotDate.getTime() > 14 * 24 * 60 * 60 * 1000,
  );

  // Derive capped from stored count — no extra DB column needed
  const capped = currentCount >= JOB_POSTING_LIMIT;

  if (!baseline) {
    return { currentCount, capped, trend: "unknown", asOf };
  }

  const previousCount = baseline.jobPostingCount!;
  const changePercent =
    previousCount > 0
      ? ((currentCount - previousCount) / previousCount) * 100
      : undefined;

  const trend =
    changePercent === undefined
      ? "unknown"
      : changePercent > 10
      ? "growing"
      : changePercent < -10
      ? "declining"
      : "stable";

  return {
    currentCount,
    capped,
    previousCount,
    changePercent: changePercent !== undefined ? Math.round(changePercent * 10) / 10 : undefined,
    trend,
    asOf,
  };
}

function buildFundingNote(intelligence: CompanyIntelligence): string | undefined {
  const rounds = intelligence.fundingHistory;
  if (!rounds || rounds.length === 0) return undefined;
  const latest = rounds[rounds.length - 1];
  const parts: string[] = [];
  if (latest.roundType) parts.push(latest.roundType);
  if (latest.amount) parts.push(latest.amount);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Enriches a company given either a domain or a company name.
 * An optional location can be provided to disambiguate companies
 * with the same name in different countries/cities.
 * Set forceRefresh=true to bypass the 30-day cache (used by the /refresh cron).
 */
export const enrichCompany = async (
  query: string,
  location?: string,
  forceRefresh = false,
): Promise<CompanyIntelligence> => {
  // Use the domain as the cache key when it's clearly a domain.
  // Otherwise, use AI to resolve the domain before checking the cache.
  // Fall back to the raw query (lowercased) if domain resolution yields null.
  let cacheKey = query.trim().toLowerCase();
  const maybeDomain = tryNormalizeDomain(query);

  if (maybeDomain) {
    cacheKey = maybeDomain;
  } else {
    if (isDev) console.log(
      `[Orchestrator] Attempting to resolve domain for: "${query}"${location ? ` (${location})` : ""}`,
    );
    const resolvedDomain = await resolveCompanyDomain(query, location);
    if (resolvedDomain) {
      if (isDev) console.log(`[Orchestrator] Resolved domain name: ${resolvedDomain}`);
      cacheKey = resolvedDomain;
    } else {
      if (isDev) console.log(
        `[Orchestrator] Could not resolve a domain for "${query}", falling back to query string key.`,
      );
    }
  }

  if (isDev) console.log(
    `[Orchestrator] Starting enrichment for: "${query}"${location ? ` (${location})` : ""}${forceRefresh ? " [force refresh]" : ""}`,
  );

  // 1. Check cache (skip if forceRefresh)
  let intelligence: CompanyIntelligence | null = null;
  let jobPostingCount: number | undefined;


  if (!forceRefresh) {
    intelligence = await getCachedCompanyData(cacheKey);
    if (intelligence) {
      if (isDev) console.log(`[Orchestrator] Cache hit for: ${cacheKey}`);
    }
  }

  // 2. Synthesize via Exa + Grok on cache miss or forced refresh
  if (!intelligence) {
    if (isDev) console.log(`[Orchestrator] Synthesizing intelligence via Exa + Grok...`);
    const result = await synthesizeCompanyProfile(query, location);
    intelligence = result.intelligence;
    jobPostingCount = result.jobPosting.count;

    // Use the synthesized domain as the canonical cache key when available —
    // it is more accurate than the pre-resolved one (e.g. Clearbit guessing wrong TLD).
    const synthesizedDomain = intelligence.firmographics?.domain?.trim().toLowerCase();
    if (synthesizedDomain && synthesizedDomain !== cacheKey) {
      if (isDev)
        console.log(
          `[Orchestrator] Canonical domain from synthesis: "${synthesizedDomain}" (was "${cacheKey}")`,
        );
      cacheKey = synthesizedDomain;
    }

    // Persist to cache
    await saveCompanyData(
      cacheKey,
      intelligence.firmographics?.name || cacheKey,
      intelligence,
    );
  }

  // 3. Read snapshot history (fails fast — 3s PG connection timeout)
  const snapshots = await getSnapshotHistory(cacheKey);
  const latestSnapshot = snapshots[0];
  const shouldSaveSnapshot =
    !latestSnapshot ||
    Date.now() - latestSnapshot.snapshotDate.getTime() > SNAPSHOT_INTERVAL_MS;

  let effectiveSnapshots = snapshots;

  if (shouldSaveSnapshot) {
    const headcount = intelligence.firmographics?.employeeCountEstimate;
    // On cache hits, jobPostingCount is undefined — carry forward the last known count
    const countToSave =
      jobPostingCount !== undefined
        ? jobPostingCount
        : (latestSnapshot?.jobPostingCount ?? undefined);
    const fundingNote = buildFundingNote(intelligence);

    // Fire-and-forget — snapshot write must never block the response
    saveSnapshot(cacheKey, headcount, countToSave, fundingNote).catch((err) =>
      console.error("[Snapshot] Background write failed:", err),
    );

    // Optimistically prepend the new snapshot so the caller sees it immediately
    // without a second round-trip to the DB
    const optimisticRow: SnapshotRow = {
      snapshotDate: new Date(),
      headcount: headcount ?? null,
      jobPostingCount: countToSave ?? null,
      fundingNote: fundingNote ?? null,
    };
    effectiveSnapshots = [optimisticRow, ...snapshots].slice(0, 6);
  }

  intelligence = mergeHistory(intelligence, effectiveSnapshots);

  if (isDev) console.log(
    `[Orchestrator] Enrichment complete for: ${cacheKey} | confidence: ${intelligence.dataQuality?.confidenceScore ?? "n/a"}`,
  );

  return intelligence;
};

function mergeHistory(
  intelligence: CompanyIntelligence,
  snapshots: SnapshotRow[],
): CompanyIntelligence {
  const headcountHistory = buildHeadcountHistory(snapshots);
  const jobPostingVelocity = buildJobPostingVelocity(snapshots);

  return {
    ...intelligence,
    headcountHistory: headcountHistory.length > 0 ? headcountHistory : undefined,
    jobPostingVelocity,
  };
}
