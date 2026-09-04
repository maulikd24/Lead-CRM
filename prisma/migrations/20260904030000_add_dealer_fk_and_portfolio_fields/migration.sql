-- Null out legacy free-text dealerId values that don't resolve to a real User.id,
-- so the new FK constraint below doesn't fail against pre-existing data.
UPDATE "DealerIntroduction" SET "dealerId" = NULL WHERE "dealerId" IS NOT NULL AND "dealerId" NOT IN (SELECT id FROM "User");

-- AlterTable
ALTER TABLE "DealerIntroduction" ADD COLUMN     "maxExposureLimit" DECIMAL(65,30),
ADD COLUMN     "maxOrderValue" DECIMAL(65,30),
ADD COLUMN     "preferredSegments" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "riskProfile" TEXT;

-- CreateIndex
CREATE INDEX "DealerIntroduction_dealerId_idx" ON "DealerIntroduction"("dealerId");

-- AddForeignKey
ALTER TABLE "DealerIntroduction" ADD CONSTRAINT "DealerIntroduction_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
