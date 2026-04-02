import { z } from "zod";

export const FirmographicsSchema = z.object({
  name: z.string(),
  domain: z.string(),
  industry: z.string().optional(),
  description: z.string().optional(),
  employeeCountEstimate: z.string().optional(),
  headquarters: z.string().optional(),
  foundedYear: z.number().optional(),
  specialties: z.array(z.string()).optional(),
  logoUrl: z.string().optional(),
});

export type Firmographics = z.infer<typeof FirmographicsSchema>;

export const FundingRoundSchema = z.object({
  date: z.string().optional(),
  amount: z.string().optional(),
  roundType: z.string().optional(),
  leadInvestors: z.array(z.string()).optional(),
});

export type FundingRound = z.infer<typeof FundingRoundSchema>;

export const KeyPersonSchema = z.object({
  name: z.string(),
  title: z.string(),
  profileUrl: z.string().optional(),
  photoUrl: z.string().optional(),
});

export type KeyPerson = z.infer<typeof KeyPersonSchema>;

export const GrowthSignalsSchema = z.object({
  hiringVelocity: z.string().optional(),
  recentLeadershipChanges: z.array(z.string()).optional(),
  fundingSignals: z.string().optional(),
  generalSignals: z.array(z.string()).optional(),
});

export type GrowthSignals = z.infer<typeof GrowthSignalsSchema>;

export const DataDiscrepancySchema = z.object({
  field: z.string(),
  conflict: z.string(),
  resolution: z.string(),
});

export type DataDiscrepancy = z.infer<typeof DataDiscrepancySchema>;

export const DataQualitySchema = z.object({
  confidenceScore: z.number(),
  sourcesUsed: z.array(z.string()),
  officialSourceFound: z.boolean(),
  discrepancies: z.array(DataDiscrepancySchema),
});

export type DataQuality = z.infer<typeof DataQualitySchema>;

export const HeadcountSnapshotSchema = z.object({
  date: z.string(),
  estimate: z.string(),
});

export const JobPostingVelocitySchema = z.object({
  currentCount: z.number(),
  capped: z.boolean().optional(), // true = real number is likely higher than currentCount
  previousCount: z.number().optional(),
  changePercent: z.number().optional(),
  trend: z.enum(["growing", "stable", "declining", "unknown"]),
  asOf: z.string(),
});

export const SearchInterestSchema = z.object({
  currentScore: z.number(),
  peakScore: z.number(),
  recentAverage: z.number(),
  baselineAverage: z.number().optional(),
  changePercent: z.number().optional(),
  trend: z.enum(["growing", "stable", "declining", "unknown"]),
  asOf: z.string(),
  sampleCount: z.number(),
  window: z.string(),
  source: z.literal("google_trends"),
});

export const ENRICH_COMPANY_OUTPUT = z.object({
  firmographics: FirmographicsSchema,
  fundingHistory: z.array(FundingRoundSchema),
  keyPersonnel: z.array(KeyPersonSchema),
  growthSignals: GrowthSignalsSchema.optional(),
  synthesis: z.string(),
  dataQuality: DataQualitySchema,
  headcountHistory: z.array(HeadcountSnapshotSchema).optional(),
  jobPostingVelocity: JobPostingVelocitySchema.optional(),
  searchInterest: SearchInterestSchema.optional(),
});

export type CompanyIntelligence = z.infer<typeof ENRICH_COMPANY_OUTPUT>;

export const ENRICH_COMPANY_INPUT = z.object({
  query: z
    .string()
    .trim()
    .describe(
      "The company domain (e.g., stripe.com) OR company name (e.g., Stripe).",
    ),
  location: z
    .string()
    .trim()
    .optional()
    .describe(
      'Optional country or city to disambiguate companies with the same name (e.g., "United Kingdom" or "Lagos").',
    ),
});

// ---- compare_companies schemas ----------------------------------------------

export const CompanyQuerySchema = z.object({
  query: z
    .string()
    .trim()
    .min(1)
    .describe("Company domain (e.g. stripe.com) or company name (e.g. Stripe)."),
  location: z
    .string()
    .trim()
    .optional()
    .describe('Optional country/city to disambiguate same-name companies (e.g. "Lagos").'),
});
export type CompanyQuery = z.infer<typeof CompanyQuerySchema>;

export const COMPARE_COMPANIES_INPUT = z.object({
  companies: z
    .array(CompanyQuerySchema)
    .min(2, "Provide at least 2 companies.")
    .max(2, "Maximum 2 companies per comparison.")
    .describe("Exactly 2 companies to compare. Each entry is a { query, location? } object."),
});
export type CompareCompaniesInput = z.infer<typeof COMPARE_COMPANIES_INPUT>;

// Slim per-company result — full intelligence is NOT returned, only comparison data
export const CompanyResultSchema = z.object({
  query: z.string(),
  succeeded: z.boolean(),
  error: z.string().optional(),
  resolvedName: z.string().optional(),
  resolvedDomain: z.string().optional(),
});
export type CompanyResult = z.infer<typeof CompanyResultSchema>;

// ---- Deterministic diff blocks ----

export const FundingComparisonSchema = z.object({
  rankedByRoundCount: z.array(z.string()),
  totalRoundsByCompany: z.record(z.string(), z.number()),
  latestRoundByCompany: z.record(z.string(), z.string()),  // "Series C · $82M · (2025-07-10)"
  notes: z.array(z.string()).optional(),
});

export const HeadcountComparisonSchema = z.object({
  rankedByEstimate: z.array(z.string()),
  estimateByCompany: z.record(z.string(), z.string().nullable()),
  trendByCompany: z.record(
    z.string(),
    z.enum(["growing", "stable", "declining", "unknown", "insufficient_data"]),
  ),
  changePercentByCompany: z.record(z.string(), z.number().nullable()),
  notes: z.array(z.string()).optional(),
});

export const HiringComparisonSchema = z.object({
  rankedByJobPostingCount: z.array(z.string()),
  currentCountByCompany: z.record(z.string(), z.number().nullable()),
  cappedByCompany: z.record(z.string(), z.boolean()),
  trendByCompany: z.record(
    z.string(),
    z.enum(["growing", "stable", "declining", "unknown"]),
  ),
  notes: z.array(z.string()).optional(),
});

export const SearchInterestComparisonSchema = z.object({
  rankedByCurrentScore: z.array(z.string()),
  rankedByMomentum: z.array(z.string()),
  currentScoreByCompany: z.record(z.string(), z.number().nullable()),
  recentAverageByCompany: z.record(z.string(), z.number().nullable()),
  changePercentByCompany: z.record(z.string(), z.number().nullable()),
  trendByCompany: z.record(
    z.string(),
    z.enum(["growing", "stable", "declining", "unknown"]),
  ),
  notes: z.array(z.string()).optional(),
});

export const AgeComparisonSchema = z.object({
  rankedByAge: z.array(z.string()),
  foundedYearByCompany: z.record(z.string(), z.number().nullable()),
});

export const IndustryOverlapSchema = z.object({
  allIndustries: z.array(z.string()),
  byCompany: z.record(z.string(), z.string().nullable()),
  shareIndustry: z.boolean(),
});

export const HeadquartersComparisonSchema = z.object({
  byCompany: z.record(z.string(), z.string().nullable()),
  sameCity: z.boolean(),
});

export const LeadershipComparisonSchema = z.object({
  ceoByCompany: z.record(z.string(), z.string().nullable()),
  ctoByCompany: z.record(z.string(), z.string().nullable()),
  foundersByCompany: z.record(z.string(), z.array(z.string())),
});

export const GrowthSignalsComparisonSchema = z.object({
  hiringVelocityByCompany: z.record(z.string(), z.string().nullable()),
  fundingSignalsByCompany: z.record(z.string(), z.string().nullable()),
  generalSignalsByCompany: z.record(z.string(), z.array(z.string())),
});

export const SpecialtiesComparisonSchema = z.object({
  byCompany: z.record(z.string(), z.array(z.string())),
  sharedSpecialties: z.array(z.string()),
  uniqueToEach: z.record(z.string(), z.array(z.string())),
});

export const DataQualityComparisonSchema = z.object({
  confidenceScoreByCompany: z.record(z.string(), z.number()),
  sourcesUsedByCompany: z.record(z.string(), z.array(z.string())),
});

export const ComparisonSchema = z.object({
  funding: FundingComparisonSchema,
  headcount: HeadcountComparisonSchema,
  hiring: HiringComparisonSchema,
  searchInterest: SearchInterestComparisonSchema,
  age: AgeComparisonSchema,
  industryOverlap: IndustryOverlapSchema,
  headquarters: HeadquartersComparisonSchema,
  leadership: LeadershipComparisonSchema,
  growthSignals: GrowthSignalsComparisonSchema,
  specialties: SpecialtiesComparisonSchema,
  dataQuality: DataQualityComparisonSchema,
});
export type Comparison = z.infer<typeof ComparisonSchema>;

export const COMPARE_COMPANIES_OUTPUT = z.object({
  companies: z.array(CompanyResultSchema),
  comparison: ComparisonSchema,
  narrative: z.string(),
  meta: z.object({
    requestedCount: z.number(),
    succeededCount: z.number(),
    failedCount: z.number(),
    partialResult: z.boolean(),
    durationMs: z.number(),
  }),
});
export type CompareCompaniesOutput = z.infer<typeof COMPARE_COMPANIES_OUTPUT>;
