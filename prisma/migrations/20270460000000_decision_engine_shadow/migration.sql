-- Decision Engine v2, SHADOW MODE. Additive only: five new tables, one nullable column on AgentProposal (nbaDecisionId) and their indexes and foreign keys.
-- The five pre-existing drift statements (Document_holderId_fkey and four HierarchyAssignment foreign keys) that `prisma migrate diff` also emits are removed by hand, as in every other migration on this stack.

-- AlterTable
ALTER TABLE "AgentProposal" ADD COLUMN     "nbaDecisionId" TEXT;

-- CreateTable
CREATE TABLE "DecisionRecord" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "causationId" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'SHADOW',
    "result" TEXT NOT NULL,
    "abstainReason" TEXT,
    "escalation" TEXT,
    "action" TEXT NOT NULL,
    "programme" TEXT NOT NULL,
    "topic" TEXT,
    "assetClass" TEXT,
    "reason" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "priorityScore" INTEGER NOT NULL,
    "owner" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "timing" TEXT NOT NULL,
    "notBefore" TIMESTAMP(3),
    "confidence" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "scoreInputs" JSONB NOT NULL,
    "suppression" JSONB NOT NULL,
    "policyResult" JSONB NOT NULL,
    "alternatives" JSONB NOT NULL,
    "legacy" JSONB,
    "chosenCandidateId" TEXT,
    "candidateCount" INTEGER NOT NULL DEFAULT 0,
    "inputHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "statusUpdatedAt" TIMESTAMP(3),
    "observedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionFeedback" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT,
    "until" TIMESTAMP(3),
    "scope" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionOutcome" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "eventRef" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "daysAfter" INTEGER NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionDisagreement" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionDisagreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionReplayRun" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "params" JSONB NOT NULL,
    "summary" JSONB NOT NULL,

    CONSTRAINT "DecisionReplayRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DecisionRecord_clientId_createdAt_idx" ON "DecisionRecord"("clientId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "DecisionRecord_result_createdAt_idx" ON "DecisionRecord"("result", "createdAt");

-- CreateIndex
CREATE INDEX "DecisionRecord_createdAt_idx" ON "DecisionRecord"("createdAt");

-- CreateIndex
CREATE INDEX "DecisionRecord_correlationId_idx" ON "DecisionRecord"("correlationId");

-- CreateIndex
CREATE INDEX "DecisionFeedback_decisionId_idx" ON "DecisionFeedback"("decisionId");

-- CreateIndex
CREATE INDEX "DecisionFeedback_kind_createdAt_idx" ON "DecisionFeedback"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "DecisionOutcome_kind_occurredAt_idx" ON "DecisionOutcome"("kind", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "DecisionOutcome_decisionId_kind_eventRef_key" ON "DecisionOutcome"("decisionId", "kind", "eventRef");

-- CreateIndex
CREATE UNIQUE INDEX "DecisionDisagreement_decisionId_key" ON "DecisionDisagreement"("decisionId");

-- CreateIndex
CREATE INDEX "DecisionDisagreement_severity_createdAt_idx" ON "DecisionDisagreement"("severity", "createdAt");

-- CreateIndex
CREATE INDEX "DecisionDisagreement_createdAt_idx" ON "DecisionDisagreement"("createdAt");

-- CreateIndex
CREATE INDEX "AgentProposal_nbaDecisionId_idx" ON "AgentProposal"("nbaDecisionId");

-- AddForeignKey
ALTER TABLE "AgentProposal" ADD CONSTRAINT "AgentProposal_nbaDecisionId_fkey" FOREIGN KEY ("nbaDecisionId") REFERENCES "DecisionRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionRecord" ADD CONSTRAINT "DecisionRecord_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionFeedback" ADD CONSTRAINT "DecisionFeedback_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "DecisionRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionOutcome" ADD CONSTRAINT "DecisionOutcome_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "DecisionRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionDisagreement" ADD CONSTRAINT "DecisionDisagreement_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "DecisionRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
