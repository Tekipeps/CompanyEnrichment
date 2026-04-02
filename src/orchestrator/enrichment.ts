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
import { fetchSearchInterest, type SearchInterestSummary } from "../data/google-trends.js";
import type { CompanyIntelligence } from "../types/index.js";

const isDev = process.env.NODE_ENV !== "production";

const SNAPSHOT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const SEARCH_INTEREST_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const tryNormalizeDomain = (input: string): string | null => {
  let domain = input.trim().toLowerCase();
  domain = domain.replace(/^https?:\/\//, "");
  domain = domain.replace(/^www\./, "");
  domain = domain.replace(/\/.*$/, "");
  return domain.includes(".") ? domain : null;
};

function buildHeadcountHistory(
  snapshots: SnapshotRow[],
): Array<{ date: string; estimate: string }> {
  return snapshots
    .filter((snapshot) => snapshot.headcount)
    .reverse()
    .map((snapshot) => ({
      date: snapshot.snapshotDate.toISOString().split("T")[0],
      estimate: snapshot.headcount!,
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
  const withCount = snapshots.filter((snapshot) => snapshot.jobPostingCount !== null);
  if (withCount.length === 0) return undefined;

  const latest = withCount[0];
  const currentCount = latest.jobPostingCount!;
  const asOf = latest.snapshotDate.toISOString().split("T")[0];
  const baseline = withCount.find(
    (snapshot) =>
      Date.now() - snapshot.snapshotDate.getTime() > 14 * 24 * 60 * 60 * 1000,
  );
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

function buildSearchInterestFromSnapshots(
  snapshots: SnapshotRow[],
): SearchInterestSummary | undefined {
  const withScore = snapshots.filter((snapshot) => snapshot.searchInterestScore !== null);
  if (withScore.length === 0) return undefined;

  const latest = withScore[0];
  const points = [...withScore]
    .reverse()
    .map((snapshot) => ({
      date: snapshot.snapshotDate.toISOString().split("T")[0],
      score: snapshot.searchInterestScore!,
    }));

  const currentScore = latest.searchInterestScore!;
  const peakScore = Math.max(...points.map((point) => point.score));
  const recentSlice = points.slice(-4);
  const baselineSlice = points.slice(-8, -4);
  const recentAverage =
    recentSlice.reduce((sum, point) => sum + point.score, 0) / recentSlice.length;
  const baselineAverage =
    baselineSlice.length > 0
      ? baselineSlice.reduce((sum, point) => sum + point.score, 0) / baselineSlice.length
      : undefined;
  const changePercent =
    baselineAverage && baselineAverage > 0
      ? ((recentAverage - baselineAverage) / baselineAverage) * 100
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
    currentScore,
    peakScore,
    recentAverage: Math.round(recentAverage * 10) / 10,
    baselineAverage:
      baselineAverage !== undefined ? Math.round(baselineAverage * 10) / 10 : undefined,
    changePercent:
      changePercent !== undefined ? Math.round(changePercent * 10) / 10 : undefined,
    trend,
    asOf: latest.snapshotDate.toISOString().split("T")[0],
    sampleCount: points.length,
    window: "snapshot_history",
    source: "google_trends",
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

function needsSearchInterestRefresh(
  searchInterest: SearchInterestSummary | undefined,
): boolean {
  if (!searchInterest?.asOf) return true;
  const asOfMs = Date.parse(searchInterest.asOf);
  if (Number.isNaN(asOfMs)) return true;
  return Date.now() - asOfMs > SEARCH_INTEREST_TTL_MS;
}

export const enrichCompany = async (
  query: string,
  location?: string,
  forceRefresh = false,
): Promise<CompanyIntelligence> => {
  let cacheKey = query.trim().toLowerCase();
  const maybeDomain = tryNormalizeDomain(query);

  if (maybeDomain) {
    cacheKey = maybeDomain;
  } else {
    if (isDev) {
      console.log(
        `[Orchestrator] Attempting to resolve domain for: "${query}"${location ? ` (${location})` : ""}`,
      );
    }
    const resolvedDomain = await resolveCompanyDomain(query, location);
    if (resolvedDomain) {
      if (isDev) console.log(`[Orchestrator] Resolved domain name: ${resolvedDomain}`);
      cacheKey = resolvedDomain;
    } else if (isDev) {
      console.log(
        `[Orchestrator] Could not resolve a domain for "${query}", falling back to query string key.`,
      );
    }
  }

  if (isDev) {
    console.log(
      `[Orchestrator] Starting enrichment for: "${query}"${location ? ` (${location})` : ""}${forceRefresh ? " [force refresh]" : ""}`,
    );
  }

  let intelligence: CompanyIntelligence | null = null;
  let jobPostingCount: number | undefined;
  let searchInterest: SearchInterestSummary | undefined;
  let prefetchedSearchInterestPromise: Promise<SearchInterestSummary | undefined> | undefined;

  if (!forceRefresh) {
    intelligence = await getCachedCompanyData(cacheKey);
    if (intelligence && isDev) {
      console.log(`[Orchestrator] Cache hit for: ${cacheKey}`);
    }
  }

  if (!intelligence) {
    if (isDev) console.log("[Orchestrator] Synthesizing intelligence via Exa + Grok...");
    const result = await synthesizeCompanyProfile(query, location);
    intelligence = result.intelligence;
    jobPostingCount = result.jobPosting.count;

    const synthesizedDomain = intelligence.firmographics?.domain?.trim().toLowerCase();
    if (synthesizedDomain && synthesizedDomain !== cacheKey) {
      if (isDev) {
        console.log(
          `[Orchestrator] Canonical domain from synthesis: "${synthesizedDomain}" (was "${cacheKey}")`,
        );
      }
      cacheKey = synthesizedDomain;
    }

    const searchInterestQuery =
      intelligence.firmographics?.name ||
      intelligence.firmographics?.domain ||
      query;
    if (isDev) {
      console.log(`[Google Trends] Prefetch starting for: ${searchInterestQuery}`);
    }
    prefetchedSearchInterestPromise = fetchSearchInterest(searchInterestQuery);

    await saveCompanyData(
      cacheKey,
      intelligence.firmographics?.name || cacheKey,
      intelligence,
    );
  }

  const snapshots = await getSnapshotHistory(cacheKey);
  const latestSnapshot = snapshots[0];
  const shouldSaveSnapshot =
    !latestSnapshot ||
    Date.now() - latestSnapshot.snapshotDate.getTime() > SNAPSHOT_INTERVAL_MS;
  const mergedSearchInterest =
    intelligence.searchInterest ?? buildSearchInterestFromSnapshots(snapshots);
  const shouldRefreshSearchInterest =
    forceRefresh || needsSearchInterestRefresh(mergedSearchInterest);

  let effectiveSnapshots = snapshots;

  if (shouldRefreshSearchInterest) {
    try {
      const searchInterestQuery =
        intelligence.firmographics?.name ||
        intelligence.firmographics?.domain ||
        query;
      if (isDev) {
        console.log(`[Google Trends] Refresh starting for: ${searchInterestQuery}`);
      }
      searchInterest = prefetchedSearchInterestPromise
        ? await prefetchedSearchInterestPromise
        : await fetchSearchInterest(searchInterestQuery);
      if (searchInterest) {
        if (isDev) {
          console.log(
            `[Google Trends] Refresh complete for: ${searchInterestQuery} (${searchInterest.currentScore})`,
          );
        }
        intelligence = {
          ...intelligence,
          searchInterest,
        };
        await saveCompanyData(
          cacheKey,
          intelligence.firmographics?.name || cacheKey,
          intelligence,
        );
      } else if (isDev) {
        console.log(`[Google Trends] No data returned for: ${searchInterestQuery}`);
      }
    } catch (err) {
      console.error("[Google Trends] Failed to fetch search interest:", err);
    }
  } else if (mergedSearchInterest && !intelligence.searchInterest) {
    intelligence = {
      ...intelligence,
      searchInterest: mergedSearchInterest,
    };
  }

  const shouldBackfillSearchInterestSnapshot =
    !shouldSaveSnapshot &&
    latestSnapshot?.searchInterestScore === null &&
    Boolean(searchInterest?.currentScore);

  if (shouldSaveSnapshot || shouldBackfillSearchInterestSnapshot) {
    const headcount = intelligence.firmographics?.employeeCountEstimate;
    const countToSave =
      jobPostingCount !== undefined
        ? jobPostingCount
        : (latestSnapshot?.jobPostingCount ?? undefined);
    const fundingNote = buildFundingNote(intelligence);
    const searchInterestScore =
      searchInterest?.currentScore ?? mergedSearchInterest?.currentScore;

    saveSnapshot(
      cacheKey,
      headcount,
      countToSave,
      searchInterestScore,
      fundingNote,
    ).catch((err) => {
      console.error("[Snapshot] Background write failed:", err);
    });

    const optimisticRow: SnapshotRow = {
      snapshotDate: new Date(),
      headcount: headcount ?? null,
      jobPostingCount: countToSave ?? null,
      searchInterestScore: searchInterestScore ?? null,
      fundingNote: fundingNote ?? null,
    };
    effectiveSnapshots = [optimisticRow, ...snapshots].slice(0, 6);
  }

  intelligence = mergeHistory(intelligence, effectiveSnapshots);

  if (isDev) {
    console.log(
      `[Orchestrator] Enrichment complete for: ${cacheKey} | confidence: ${intelligence.dataQuality?.confidenceScore ?? "n/a"}`,
    );
  }

  return intelligence;
};

function mergeHistory(
  intelligence: CompanyIntelligence,
  snapshots: SnapshotRow[],
): CompanyIntelligence {
  const headcountHistory = buildHeadcountHistory(snapshots);
  const jobPostingVelocity = buildJobPostingVelocity(snapshots);
  const searchInterest =
    intelligence.searchInterest ?? buildSearchInterestFromSnapshots(snapshots);

  return {
    ...intelligence,
    headcountHistory: headcountHistory.length > 0 ? headcountHistory : undefined,
    jobPostingVelocity,
    searchInterest,
  };
}
