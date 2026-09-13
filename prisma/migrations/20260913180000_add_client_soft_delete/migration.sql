-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Client_isDeleted_idx" ON "Client"("isDeleted");
