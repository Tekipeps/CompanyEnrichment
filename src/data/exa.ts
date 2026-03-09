import { Exa } from "exa-js";

const exa = new Exa(process.env.EXA_API_KEY ?? "");

export interface ExaResult {
  url: string;
  title: string;
  text: string;
}

function mapResults(
  results: Array<{ url: string; title?: string | null; text?: string | null }>,
): ExaResult[] {
  return results.map((r) => ({
    url: r.url ?? "",
    title: r.title ?? "",
    text: (r.text ?? "").slice(0, 1000), // cap per result to control context size
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
