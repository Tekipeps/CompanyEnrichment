CREATE TABLE "CompanySnapshot" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "headcount" TEXT,
    "jobPostingCount" INTEGER,
    "fundingNote" TEXT,
    CONSTRAINT "CompanySnapshot_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CompanySnapshot_domain_snapshotDate_idx" ON "CompanySnapshot"("domain", "snapshotDate");
