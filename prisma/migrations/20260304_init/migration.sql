-- CreateTable
CREATE TABLE "CompanyEnrichment" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "name" TEXT,
    "data" TEXT NOT NULL,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyEnrichment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyEnrichment_domain_key" ON "CompanyEnrichment"("domain");

-- CreateIndex
CREATE INDEX "CompanyEnrichment_domain_idx" ON "CompanyEnrichment"("domain");
