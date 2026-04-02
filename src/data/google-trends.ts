import { randomUUID } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { SocksProxyAgent } from "socks-proxy-agent";

type TrendsWidget = {
  id?: string;
  request?: Record<string, unknown>;
  token?: string;
};

type TimelinePoint = {
  time?: string;
  value?: number[];
};

type TrendsClient = {
  requestGoogleTrends: (path: string, params: Record<string, string>) => Promise<string>;
};

export type SearchInterestSummary = {
  currentScore: number;
  peakScore: number;
  recentAverage: number;
  baselineAverage?: number;
  changePercent?: number;
  trend: "growing" | "stable" | "declining" | "unknown";
  asOf: string;
  sampleCount: number;
  window: string;
  source: "google_trends";
};

const TRENDS_BASE_URL = "https://trends.google.com";
const DEFAULT_WINDOW = "today 12-m";
const DEFAULT_HEADERS = {
  "accept-language": "en-US,en;q=0.9",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
};
const REQUEST_TIMEOUT_MS = 15_000;
const proxyUrl = normalizeProxyUrl(process.env.GOOGLE_TRENDS_PROXY_URL);

function normalizeProxyUrl(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  if (trimmed.includes("://")) return trimmed;
  return `socks5://${trimmed}`;
}

function cleanJsonPrefix(payload: string): string {
  return payload.replace(/^\)\]\}',?\s*/, "");
}

function buildUrl(path: string, params: Record<string, string>): string {
  const url = new URL(path, TRENDS_BASE_URL);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return url.toString();
}

function firstSetCookie(headers: IncomingHttpHeaders): string | undefined {
  const raw = headers["set-cookie"];
  if (!raw) return undefined;
  return Array.isArray(raw) ? raw[0] : raw;
}

function buildSessionizedProxyUrl(baseProxyUrl: string | undefined): string | undefined {
  if (!baseProxyUrl) return undefined;

  const url = new URL(baseProxyUrl);
  const sessionId = randomUUID().replace(/-/g, "").slice(0, 12);

  if (url.username.includes("-nnid-")) {
    url.username = url.username.replace(/-nnid-[^:@]+$/, `-nnid-${sessionId}`);
  }

  return url.toString();
}

function requestText(
  url: string,
  headers: Record<string, string>,
  agent?: SocksProxyAgent,
): Promise<{ statusCode: number; headers: IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        method: "GET",
        headers,
        agent,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body,
          });
        });
      },
    );

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`Google Trends request timed out after ${REQUEST_TIMEOUT_MS}ms`));
    });
    req.on("error", reject);
    req.end();
  });
}

function createTrendsClient(): TrendsClient {
  const sessionizedProxyUrl = buildSessionizedProxyUrl(proxyUrl);
  const agent = sessionizedProxyUrl ? new SocksProxyAgent(sessionizedProxyUrl) : undefined;
  let cookieHeader = "";

  return {
    async requestGoogleTrends(path: string, params: Record<string, string>): Promise<string> {
      const url = buildUrl(path, params);
      const baseHeaders = cookieHeader
        ? { ...DEFAULT_HEADERS, cookie: cookieHeader }
        : DEFAULT_HEADERS;

      let response = await requestText(url, baseHeaders, agent);

      if (response.statusCode === 429) {
        const nextCookie = firstSetCookie(response.headers);
        if (nextCookie) {
          cookieHeader = nextCookie.split(";")[0] ?? "";
          response = await requestText(
            url,
            { ...DEFAULT_HEADERS, cookie: cookieHeader },
            agent,
          );
        }
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(`Google Trends request failed (${response.statusCode})`);
      }

      return response.body;
    },
  };
}

function parseExploreWidgets(payload: string): TrendsWidget[] {
  const parsed = JSON.parse(cleanJsonPrefix(payload)) as { widgets?: TrendsWidget[] };
  return parsed.widgets ?? [];
}

function parseTimeline(payload: string): TimelinePoint[] {
  const parsed = JSON.parse(cleanJsonPrefix(payload)) as {
    default?: { timelineData?: TimelinePoint[] };
  };
  return parsed.default?.timelineData ?? [];
}

function buildSummary(
  points: Array<{ date: string; score: number }>,
): SearchInterestSummary | undefined {
  if (points.length === 0) return undefined;

  const latest = points.at(-1);
  if (!latest) return undefined;

  const scores = points.map((point) => point.score);
  const peakScore = Math.max(...scores);

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
    currentScore: latest.score,
    peakScore,
    recentAverage: Math.round(recentAverage * 10) / 10,
    baselineAverage:
      baselineAverage !== undefined ? Math.round(baselineAverage * 10) / 10 : undefined,
    changePercent:
      changePercent !== undefined ? Math.round(changePercent * 10) / 10 : undefined,
    trend,
    asOf: latest.date,
    sampleCount: points.length,
    window: DEFAULT_WINDOW,
    source: "google_trends",
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchSearchInterest(
  keyword: string,
): Promise<SearchInterestSummary | undefined> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const client = createTrendsClient();

    try {
      const explorePayload = await client.requestGoogleTrends("/trends/api/explore", {
        hl: "en-US",
        tz: "0",
        req: JSON.stringify({
          comparisonItem: [{ keyword, geo: "", time: DEFAULT_WINDOW }],
          category: 0,
          property: "",
        }),
      });

      const widgets = parseExploreWidgets(explorePayload);
      const widget = widgets.find((candidate) => candidate.id?.includes("TIMESERIES"));

      if (!widget?.request || !widget.token) {
        return undefined;
      }

      const timelinePayload = await client.requestGoogleTrends("/trends/api/widgetdata/multiline", {
        hl: "en-US",
        tz: "0",
        req: JSON.stringify(widget.request),
        token: widget.token,
      });

      const points = parseTimeline(timelinePayload)
        .map((point) => {
          const score = point.value?.[0];
          const unixTime = point.time ? Number(point.time) : Number.NaN;
          if (score === undefined || Number.isNaN(unixTime)) return null;
          return {
            date: new Date(unixTime * 1000).toISOString().slice(0, 10),
            score,
          };
        })
        .filter((point): point is { date: string; score: number } => point !== null);

      return buildSummary(points);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const canRetry = attempt === 0 && message.includes("(429)");
      if (!canRetry) throw error;
      await sleep(350);
    }
  }

  return undefined;
}
