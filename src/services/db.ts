import { PrismaClient } from "../../prisma/generated/client.js";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { createClient } from "@libsql/client";
import type { CompanyIntelligence } from "../types/enrichment.js";

const adapter = new PrismaLibSql({
  url: process.env.DATABASE_URL || "file:./dev.db",
});
const prisma = new PrismaClient({ adapter });

// Invalidation threshold: 30 days
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const getCachedCompanyData = async (
  domain: string,
): Promise<CompanyIntelligence | null> => {
  try {
    const record = await prisma.companyEnrichment.findUnique({
      where: { domain },
    });

    if (!record) {
      return null;
    }

    const now = new Date();
    const timeSinceLastUpdate = now.getTime() - record.lastUpdated.getTime();

    if (timeSinceLastUpdate > CACHE_TTL_MS) {
      console.log(`[Cache] Data for ${domain} is stale. Fetching new data.`);
      return null;
    }

    console.log(`[Cache] Returning cached data for ${domain}`);
    return JSON.parse(record.data) as CompanyIntelligence;
  } catch (error) {
    console.error("[Cache Error] Failed to retrieve data:", error);
    return null;
  }
};

export const saveCompanyData = async (
  domain: string,
  name: string,
  data: CompanyIntelligence,
): Promise<void> => {
  try {
    await prisma.companyEnrichment.upsert({
      where: { domain },
      update: {
        name,
        data: JSON.stringify(data),
        lastUpdated: new Date(),
      },
      create: {
        domain,
        name,
        data: JSON.stringify(data),
      },
    });
    console.log(`[Cache] Saved data for ${domain}`);
  } catch (error) {
    console.error("[Cache Error] Failed to save data:", error);
  }
};
