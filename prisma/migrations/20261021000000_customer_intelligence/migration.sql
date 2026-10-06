-- Customer Intelligence: category, lifecycle/NBA cache, asset-class acceptance, conversation insights, outcomes, segments.

-- CreateEnum
CREATE TYPE "AcceptanceLevel" AS ENUM ('HIGH', 'MEDIUM', 'LOW');
CREATE TYPE "InsightKind" AS ENUM ('INTEREST', 'OBJECTION', 'QUESTION', 'CONCERN', 'COMMITMENT', 'COMPLAINT', 'PRODUCT_DISCUSSED', 'DECLINED', 'EXTERNAL_HOLDING', 'INCORRECT_INFO', 'COMPLIANCE_CONCERN', 'MISSED_OPPORTUNITY');
CREATE TYPE "InsightStatus" AS ENUM ('OPEN', 'DONE', 'DISMISSED');
CREATE TYPE "InteractionOutcomeType" AS ENUM ('INTERESTED', 'NOT_INTERESTED', 'FOLLOW_UP', 'CONVERTED', 'NOT_RELEVANT', 'RM_HANDOVER', 'SERVICE_ISSUE');

-- AlterTable
ALTER TABLE "Client" ADD COLUMN "customerCategory" TEXT;
ALTER TABLE "ConversationReview" ADD COLUMN "insightsExtractedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CustomerIntelligence" (
    "clientId" TEXT NOT NULL,
    "lifecycleStage" TEXT NOT NULL,
    "lifecycleUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dematTransferStatus" TEXT,
    "mfTransferStatus" TEXT,
    "externalPortfolioEstimate" DECIMAL(65,30),
    "mfTransferEstimate" DECIMAL(65,30),
    "idleCashEstimate" DECIMAL(65,30),
    "estimatesSource" TEXT,
    "estimatesUpdatedAt" TIMESTAMP(3),
    "nbaProgramme" TEXT NOT NULL,
    "nbaAction" TEXT NOT NULL,
    "nbaTopic" TEXT,
    "nbaReason" TEXT NOT NULL,
    "nbaPriority" TEXT NOT NULL,
    "nbaOwner" TEXT NOT NULL,
    "nbaTiming" TEXT NOT NULL,
    "priorityScore" INTEGER NOT NULL DEFAULT 0,
    "talkingPoints" JSONB NOT NULL,
    "situations" JSONB NOT NULL,
    "doNotDiscuss" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastInsightAt" TIMESTAMP(3),

    CONSTRAINT "CustomerIntelligence_pkey" PRIMARY KEY ("clientId")
);

CREATE TABLE "AssetClassAcceptance" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "assetClass" TEXT NOT NULL,
    "level" "AcceptanceLevel" NOT NULL,
    "source" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetClassAcceptance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConversationInsight" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "kind" "InsightKind" NOT NULL,
    "assetClass" TEXT,
    "text" TEXT NOT NULL,
    "status" "InsightStatus" NOT NULL DEFAULT 'OPEN',
    "dueAt" TIMESTAMP(3),
    "severity" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,

    CONSTRAINT "ConversationInsight_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InteractionOutcome" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "outcome" "InteractionOutcomeType" NOT NULL,
    "channel" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "assetClass" TEXT,
    "programme" TEXT,
    "note" TEXT,
    "summary" TEXT,
    "followUpAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InteractionOutcome_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SegmentMembership" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "segment" TEXT NOT NULL,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exitedAt" TIMESTAMP(3),

    CONSTRAINT "SegmentMembership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerIntelligence_nbaPriority_priorityScore_idx" ON "CustomerIntelligence"("nbaPriority", "priorityScore");
CREATE INDEX "CustomerIntelligence_lifecycleStage_idx" ON "CustomerIntelligence"("lifecycleStage");
CREATE INDEX "CustomerIntelligence_computedAt_idx" ON "CustomerIntelligence"("computedAt");
CREATE UNIQUE INDEX "AssetClassAcceptance_clientId_assetClass_key" ON "AssetClassAcceptance"("clientId", "assetClass");
CREATE INDEX "AssetClassAcceptance_assetClass_level_idx" ON "AssetClassAcceptance"("assetClass", "level");
CREATE UNIQUE INDEX "ConversationInsight_dedupeKey_key" ON "ConversationInsight"("dedupeKey");
CREATE INDEX "ConversationInsight_clientId_kind_status_idx" ON "ConversationInsight"("clientId", "kind", "status");
CREATE INDEX "ConversationInsight_kind_status_occurredAt_idx" ON "ConversationInsight"("kind", "status", "occurredAt");
CREATE INDEX "ConversationInsight_assetClass_kind_idx" ON "ConversationInsight"("assetClass", "kind");
CREATE INDEX "InteractionOutcome_clientId_createdAt_idx" ON "InteractionOutcome"("clientId", "createdAt");
CREATE INDEX "InteractionOutcome_outcome_createdAt_idx" ON "InteractionOutcome"("outcome", "createdAt");
CREATE UNIQUE INDEX "SegmentMembership_clientId_segment_key" ON "SegmentMembership"("clientId", "segment");
CREATE INDEX "SegmentMembership_segment_exitedAt_idx" ON "SegmentMembership"("segment", "exitedAt");

-- AddForeignKey
ALTER TABLE "CustomerIntelligence" ADD CONSTRAINT "CustomerIntelligence_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssetClassAcceptance" ADD CONSTRAINT "AssetClassAcceptance_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConversationInsight" ADD CONSTRAINT "ConversationInsight_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InteractionOutcome" ADD CONSTRAINT "InteractionOutcome_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SegmentMembership" ADD CONSTRAINT "SegmentMembership_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
