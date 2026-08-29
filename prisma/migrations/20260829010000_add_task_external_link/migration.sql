-- AlterTable
ALTER TABLE "public"."Task"
  ADD COLUMN     "externalProvider" TEXT,
  ADD COLUMN     "externalId" TEXT,
  ADD COLUMN     "externalUrl" TEXT;

-- CreateIndex
CREATE INDEX "Task_externalProvider_externalId_idx" ON "public"."Task"("externalProvider", "externalId");
