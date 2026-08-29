-- AlterTable
ALTER TABLE "public"."Client"
  ADD COLUMN     "nextActionTitle" TEXT,
  ADD COLUMN     "nextActionDueAt" TIMESTAMP(3),
  ADD COLUMN     "nextActionOwnerId" TEXT;

-- CreateIndex
CREATE INDEX "Client_nextActionDueAt_idx" ON "public"."Client"("nextActionDueAt");

-- AddForeignKey
ALTER TABLE "public"."Client" ADD CONSTRAINT "Client_nextActionOwnerId_fkey" FOREIGN KEY ("nextActionOwnerId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "public"."StageHistory"
  ADD COLUMN     "slaMet" BOOLEAN,
  ADD COLUMN     "durationHours" DOUBLE PRECISION;
