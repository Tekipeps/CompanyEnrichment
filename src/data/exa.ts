import { Exa } from "exa-js";

const exa = new Exa(process.env.EXA_API_KEY ?? "");

export interface ExaResult {
  url: string;
  title: string;
  text: string;
}

/**
 * Strips characters that cause JSON serialisation to produce invalid output
 * when the string is later embedded in an API request body:
 *   - Lone UTF-16 surrogates (U+D800–U+DFFF) — JSON.stringify emits \uD8xx
 *     which many parsers (including xAI) reject as malformed hex escapes.
 *   - C0/C1 control characters except tab, LF, CR which are safe in JSON strings.
 */
function sanitize(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .replace(/[\uD800-\uDFFF]/g, "") // lone surrogates
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, ""); // control chars
}

function mapResults(
  results: Array<{ url: string; title?: string | null; text?: string | null }>,
): ExaResult[] {
  return results.map((r) => ({
    url: sanitize(r.url) || "",
    title: sanitize(r.title) || "",
    text: sanitize(r.text).slice(0, 2000), // cap per result to control context size
  }));
}

export async function searchCompanyProfile(
  query: string,
  location?: string,
): Promise<ExaResult[]> {
  const hint = location ? ` ${location}` : "";
  const { results } = await exa.search(
    `${query}${hint} company profile headquarters employees industry description founded`,
    { numResults: 3, contents: { text: true } },
  );
  return mapResults(results);
}

export async function searchFundingHistory(
  query: string,
): Promise<ExaResult[]> {
  const { results } = await exa.search(
    `${query} funding rounds investment raised venture capital series investors`,
    { numResults: 3, contents: { text: true } },
  );
  return mapResults(results);
}

export async function searchKeyPersonnel(query: string): Promise<ExaResult[]> {
  const { results } = await exa.search(
    `${query} CEO founder executive leadership C-suite team`,
    { numResults: 3, contents: { text: true } },
  );
  return mapResults(results);
}

export const JOB_POSTING_LIMIT = 25;

export interface JobPostingSearchResult {
  count: number;
  capped: boolean; // true when count hit the limit — real number is likely higher
  results: ExaResult[];
}

export async function searchJobPostings(query: string): Promise<JobPostingSearchResult> {
  const { results } = await exa.search(
    `${query} open positions hiring careers jobs site:greenhouse.io OR site:lever.co OR site:jobs.ashbyhq.com`,
    { numResults: JOB_POSTING_LIMIT },
  );

  // Deduplicate by URL — Exa can occasionally return the same page twice
  const seen = new Set<string>();
  const unique = results.filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  return {
    count: unique.length,
    capped: unique.length >= JOB_POSTING_LIMIT,
    results: mapResults(unique),
  };
}
