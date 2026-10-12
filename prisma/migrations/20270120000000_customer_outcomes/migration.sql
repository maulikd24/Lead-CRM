-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('ACTIVE', 'ACHIEVED', 'PAUSED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "CustomerGoal" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targetAmount" DECIMAL(65,30) NOT NULL,
    "targetDate" TIMESTAMP(3) NOT NULL,
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "status" "GoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "assumedAnnualRatePct" DECIMAL(65,30),
    "plannedMonthly" DECIMAL(65,30),
    "notes" TEXT,
    "linkedAccountIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "linkedHoldingKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerReview" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuggestionDismissal" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "reason" TEXT,
    "dismissedById" TEXT,
    "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snoozeUntil" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SuggestionDismissal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutcomeEvent" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "goalId" TEXT,
    "actorId" TEXT,
    "props" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutcomeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerGoal_clientId_status_idx" ON "CustomerGoal"("clientId", "status");

-- CreateIndex
CREATE INDEX "CustomerGoal_targetDate_idx" ON "CustomerGoal"("targetDate");

-- CreateIndex
CREATE INDEX "CustomerReview_clientId_reviewedAt_idx" ON "CustomerReview"("clientId", "reviewedAt" DESC);

-- CreateIndex
CREATE INDEX "SuggestionDismissal_clientId_ruleKey_idx" ON "SuggestionDismissal"("clientId", "ruleKey");

-- CreateIndex
CREATE INDEX "SuggestionDismissal_snoozeUntil_idx" ON "SuggestionDismissal"("snoozeUntil");

-- CreateIndex
CREATE INDEX "OutcomeEvent_clientId_createdAt_idx" ON "OutcomeEvent"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "OutcomeEvent_name_createdAt_idx" ON "OutcomeEvent"("name", "createdAt");

-- AddForeignKey
ALTER TABLE "CustomerGoal" ADD CONSTRAINT "CustomerGoal_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerReview" ADD CONSTRAINT "CustomerReview_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuggestionDismissal" ADD CONSTRAINT "SuggestionDismissal_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutcomeEvent" ADD CONSTRAINT "OutcomeEvent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
