import { PrismaClient } from "../../prisma/generated/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import type { CompanyIntelligence } from "../types/index.js";

const isDev = process.env.NODE_ENV !== "production";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
export const prisma = new PrismaClient({ adapter });

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
      if (isDev) console.log(`[Cache] Data for ${domain} is stale. Fetching new data.`);
      return null;
    }

    if (isDev) console.log(`[Cache] Returning cached data for ${domain}`);
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
    if (isDev) console.log(`[Cache] Saved data for ${domain}`);
  } catch (error) {
    console.error("[Cache Error] Failed to save data:", error);
  }
};

// ---- Snapshot helpers -------------------------------------------------------

export type SnapshotRow = {
  snapshotDate: Date;
  headcount: string | null;
  jobPostingCount: number | null;
  fundingNote: string | null;
};

export const saveSnapshot = async (
  domain: string,
  headcount: string | undefined,
  jobPostingCount: number | undefined,
  fundingNote: string | undefined,
): Promise<void> => {
  try {
    await prisma.companySnapshot.create({
      data: {
        domain,
        headcount: headcount ?? null,
        jobPostingCount: jobPostingCount ?? null,
        fundingNote: fundingNote ?? null,
      },
    });
    if (isDev) console.log(`[Snapshot] Saved snapshot for ${domain}`);
  } catch (error) {
    console.error("[Snapshot Error] Failed to save snapshot:", error);
  }
};

export const getSnapshotHistory = async (domain: string): Promise<SnapshotRow[]> => {
  try {
    return await prisma.companySnapshot.findMany({
      where: { domain },
      orderBy: { snapshotDate: "desc" },
      take: 6,
      select: {
        snapshotDate: true,
        headcount: true,
        jobPostingCount: true,
        fundingNote: true,
      },
    });
  } catch (error) {
    console.error("[Snapshot Error] Failed to retrieve history:", error);
    return [];
  }
};

export const getOldestDomains = async (limit: number): Promise<string[]> => {
  try {
    const records = await prisma.companyEnrichment.findMany({
      orderBy: { lastUpdated: "asc" },
      take: limit,
      select: { domain: true },
    });
    return records.map((r) => r.domain);
  } catch (error) {
    console.error("[DB Error] Failed to get oldest domains:", error);
    return [];
  }
};
