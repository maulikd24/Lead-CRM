-- CreateTable
CREATE TABLE "AutopilotRecommendation" (
    "id" TEXT NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "issue" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "action" JSONB NOT NULL,
    "impact" JSONB NOT NULL,
    "confidence" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "undoToken" TEXT,
    "lastError" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutopilotRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutopilotDecision" (
    "id" TEXT NOT NULL,
    "recId" TEXT NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reasonCode" TEXT,
    "note" TEXT,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutopilotDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutopilotRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "metric" TEXT NOT NULL,
    "op" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "days" INTEGER NOT NULL,
    "campaignIds" JSONB,
    "action" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutopilotRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutopilotLaunchDraft" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "estimates" JSONB NOT NULL,
    "checklist" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "complianceOk" BOOLEAN NOT NULL DEFAULT false,
    "annexureApproved" BOOLEAN NOT NULL DEFAULT false,
    "externalId" TEXT,
    "createdById" TEXT NOT NULL,
    "launchedById" TEXT,
    "launchedAt" TIMESTAMP(3),
    "activatedById" TEXT,
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutopilotLaunchDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutopilotPlan" (
    "campaignId" TEXT NOT NULL,
    "plannedMonthlyBudget" DOUBLE PRECISION,
    "targetCostPerFunded" DOUBLE PRECISION,
    "contactSlaMinutes" INTEGER,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutopilotPlan_pkey" PRIMARY KEY ("campaignId")
);

-- CreateTable
CREATE TABLE "AutopilotDataset" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutopilotDataset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutopilotRecommendation_status_lastSeenAt_idx" ON "AutopilotRecommendation"("status", "lastSeenAt");

-- CreateIndex
CREATE INDEX "AutopilotDecision_ruleKey_createdAt_idx" ON "AutopilotDecision"("ruleKey", "createdAt");

-- CreateIndex
CREATE INDEX "AutopilotDecision_recId_idx" ON "AutopilotDecision"("recId");

-- CreateIndex
CREATE INDEX "AutopilotLaunchDraft_status_createdAt_idx" ON "AutopilotLaunchDraft"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AutopilotDataset_kind_platform_capturedAt_idx" ON "AutopilotDataset"("kind", "platform", "capturedAt");

