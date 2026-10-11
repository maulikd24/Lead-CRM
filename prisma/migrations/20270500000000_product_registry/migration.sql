-- Product and Eligibility Registry (Wave 2 C). Additive only: two new tables, one foreign key between them, no change to any existing table.

-- CreateTable
CREATE TABLE "RegistryProduct" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "isExample" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "activeVersionId" TEXT,
    "statusReason" TEXT,
    "statusChangedAt" TIMESTAMP(3),
    "statusChangedBy" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegistryProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistryProductVersion" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'DRAFT',
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "summary" TEXT,
    "availability" TEXT NOT NULL,
    "minInvestmentMinor" BIGINT,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "riskCategory" TEXT NOT NULL,
    "jurisdictions" TEXT[],
    "requiredDocuments" TEXT[],
    "eligibility" JSONB NOT NULL DEFAULT '[]',
    "salesRestrictions" JSONB NOT NULL DEFAULT '[]',
    "claims" JSONB NOT NULL DEFAULT '[]',
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,

    CONSTRAINT "RegistryProductVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RegistryProduct_key_key" ON "RegistryProduct"("key");

-- CreateIndex
CREATE INDEX "RegistryProduct_status_idx" ON "RegistryProduct"("status");

-- CreateIndex
CREATE INDEX "RegistryProductVersion_productId_state_idx" ON "RegistryProductVersion"("productId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "RegistryProductVersion_productId_versionNo_key" ON "RegistryProductVersion"("productId", "versionNo");

-- AddForeignKey
ALTER TABLE "RegistryProductVersion" ADD CONSTRAINT "RegistryProductVersion_productId_fkey" FOREIGN KEY ("productId") REFERENCES "RegistryProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
