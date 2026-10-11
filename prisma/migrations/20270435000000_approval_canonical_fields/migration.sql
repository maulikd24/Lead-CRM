-- Canonical approval fields on the existing generic ApprovalRequest. Additive only: three nullable columns and one index.
ALTER TABLE "ApprovalRequest" ADD COLUMN "correlationId" TEXT;
ALTER TABLE "ApprovalRequest" ADD COLUMN "causationId" TEXT;
ALTER TABLE "ApprovalRequest" ADD COLUMN "autonomyLevel" TEXT;
CREATE INDEX "ApprovalRequest_correlationId_idx" ON "ApprovalRequest"("correlationId");
