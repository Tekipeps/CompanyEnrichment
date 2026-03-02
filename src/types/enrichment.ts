export interface Firmographics {
  name: string;
  domain: string;
  industry?: string;
  description?: string;
  employeeCountEstimate?: string;
  headquarters?: string;
  foundedYear?: number;
  specialties?: string[];
  logoUrl?: string;
}

export interface FundingRound {
  date?: string;
  amount?: string;
  roundType?: string;
  leadInvestors?: string[];
}

export interface KeyPerson {
  name: string;
  title: string;
  profileUrl?: string;
  photoUrl?: string;
}

export interface GrowthSignals {
  hiringVelocity?: string;
  recentLeadershipChanges?: string[];
  fundingSignals?: string;
  generalSignals?: string[];
}

export interface DataDiscrepancy {
  /** The field where conflicting data was found (e.g. "employeeCount") */
  field: string;
  /** Description of the conflict between sources */
  conflict: string;
  /** Which value was chosen, and why */
  resolution: string;
}

export interface DataQuality {
  /** 0–1 confidence score for the overall intelligence report */
  confidenceScore: number;
  /** Names / types of sources that contributed to this report */
  sourcesUsed: string[];
  /** Whether any authoritative official source (website / IR) was found */
  officialSourceFound: boolean;
  /** Detected conflicts between sources and how they were resolved */
  discrepancies: DataDiscrepancy[];
}

export interface CompanyIntelligence {
  firmographics: Firmographics;
  fundingHistory: FundingRound[];
  keyPersonnel: KeyPerson[];
  growthSignals?: GrowthSignals;
  synthesis?: string; // AI generated synthesis of the above
  dataQuality?: DataQuality;
}

export interface EnrichmentOptions {
  domain: string;
  forceRefresh?: boolean;
}
