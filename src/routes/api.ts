import { Router } from "express";
import type { Request, Response } from "express";
import { enrichCompany } from "../orchestrator/enrichment.js";
import { logger } from "../utils/logger.js";

export const apiRouter = Router();

function formatError(code: string, message: string) {
  return { error: true, code, message };
}

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
