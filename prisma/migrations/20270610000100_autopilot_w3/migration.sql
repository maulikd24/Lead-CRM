-- Autopilot, Wave 3: audit runs with correlation ids, proposal expiry, rule account scoping, the second-approver switch and the weekly digest.
-- Additive only. No table here has a foreign key to Client (erasure needs no change); user ids are plain references.

ALTER TABLE "AutopilotRecommendation" ADD COLUMN "auditRunId" TEXT,
ADD COLUMN "correlationId" TEXT,
ADD COLUMN "expiresAt" TIMESTAMP(3);

ALTER TABLE "AutopilotDecision" ADD COLUMN "correlationId" TEXT;

ALTER TABLE "AutopilotRule" ADD COLUMN "accountIds" JSONB,
ADD COLUMN "source" TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE "AutopilotPlan" ADD COLUMN "requireSecondApprover" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "AutopilotRecommendation_correlationId_idx" ON "AutopilotRecommendation"("correlationId");

CREATE TABLE "AutopilotAuditRun" (
    "id" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "startedById" TEXT,
    "dataThrough" TIMESTAMP(3),
    "healthScore" INTEGER,
    "proposals" INTEGER NOT NULL DEFAULT 0,
    "newProposals" INTEGER NOT NULL DEFAULT 0,
    "wastedSpend" DOUBLE PRECISION,
    "error" TEXT,

    CONSTRAINT "AutopilotAuditRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AutopilotAuditRun_correlationId_key" ON "AutopilotAuditRun"("correlationId");
CREATE INDEX "AutopilotAuditRun_startedAt_idx" ON "AutopilotAuditRun"("startedAt");

CREATE TABLE "AutopilotDigest" (
    "id" TEXT NOT NULL,
    "weekStart" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "recipients" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "AutopilotDigest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AutopilotDigest_weekStart_key" ON "AutopilotDigest"("weekStart");
CREATE INDEX "AutopilotDigest_status_createdAt_idx" ON "AutopilotDigest"("status", "createdAt");
