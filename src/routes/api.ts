import { Router } from "express";
import type { Request, Response } from "express";
import { enrichCompany } from "../orchestrator/enrichment.js";
import { getOldestDomains } from "../services/db.js";
import { basicAuth } from "../middleware/basicAuth.js";
import { logger } from "../utils/logger.js";

export const apiRouter = Router();

function formatError(code: string, message: string) {
  return { error: true, code, message };
}

// Background refresh — re-enriches the N least-recently-updated companies.
// Protected by rapidApiAuth (applied in server.ts before this router).
// Intended to be called by an external cron service every 7 days.
apiRouter.get("/refresh", basicAuth, async (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query["limit"]) || 5, 20);

  logger.info(`REST GET /api/refresh — batch size: ${limit}`);

  const domains = await getOldestDomains(limit);
  const refreshed: string[] = [];

  for (const domain of domains) {
    try {
      await enrichCompany(domain, undefined, /* forceRefresh= */ true);
      refreshed.push(domain);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Refresh failed for ${domain}: ${msg}`);
    }
  }

  res.json({ refreshed: refreshed.length, domains: refreshed });
});

apiRouter.get("/enrich", async (req: Request, res: Response) => {
  const rawQuery = req.query["query"];
  const location = req.query["location"];

  if (typeof rawQuery !== "string" || !rawQuery.trim()) {
    res
      .status(400)
      .json(
        formatError("INVALID_INPUT", "Missing required query param: query"),
      );
    return;
  }

  const query = rawQuery.trim();
  const locationStr =
    typeof location === "string" ? location.trim() : undefined;

  logger.info(
    `REST GET /api/enrich for: ${query}${locationStr ? ` (${locationStr})` : ""}`,
  );

  try {
    const intelligence = await enrichCompany(query, locationStr);
    res.status(200).json(intelligence);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`REST /api/enrich failed: ${msg}`);
    res.status(500).json(formatError("ENRICHMENT_ERROR", msg));
  }
});
