-- AlterTable
ALTER TABLE "Client" ADD COLUMN "investmentCategory" TEXT;

-- Backfill existing clients — Investment Category is a new concept, all existing clients default to "Wealth"
UPDATE "Client" SET "investmentCategory" = 'Wealth' WHERE "investmentCategory" IS NULL;

-- CreateTable
CREATE TABLE "PmsAifHolding" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_INVESTED',
    "amount" DECIMAL(65,30),
    "investedDate" TIMESTAMP(3),
    "remarks" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PmsAifHolding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PmsAifHolding_clientId_productName_key" ON "PmsAifHolding"("clientId", "productName");

-- AddForeignKey
ALTER TABLE "PmsAifHolding" ADD CONSTRAINT "PmsAifHolding_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
