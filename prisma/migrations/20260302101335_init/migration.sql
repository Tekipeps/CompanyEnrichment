-- CreateTable
CREATE TABLE "CompanyEnrichment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "domain" TEXT NOT NULL,
    "name" TEXT,
    "data" TEXT NOT NULL,
    "lastUpdated" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyEnrichment_domain_key" ON "CompanyEnrichment"("domain");

-- CreateIndex
CREATE INDEX "CompanyEnrichment_domain_idx" ON "CompanyEnrichment"("domain");
