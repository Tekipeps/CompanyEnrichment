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

export const ENRICH_COMPANY_OUTPUT = z.object({
  firmographics: FirmographicsSchema,
  fundingHistory: z.array(FundingRoundSchema),
  keyPersonnel: z.array(KeyPersonSchema),
  growthSignals: GrowthSignalsSchema.optional(),
  synthesis: z.string().optional(),
  dataQuality: DataQualitySchema.optional(),
});

export type CompanyIntelligence = z.infer<typeof ENRICH_COMPANY_OUTPUT>;
