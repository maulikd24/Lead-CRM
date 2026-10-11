-- A director report link is published only after a person approves it (canonical approval kind director-report). Existing links stay live
-- (awaitingApproval defaults to false); a new link is created with awaitingApproval = true and only works once it is approved.
-- AlterTable
ALTER TABLE "ReportShare" ADD COLUMN     "awaitingApproval" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "decisionNote" TEXT;
