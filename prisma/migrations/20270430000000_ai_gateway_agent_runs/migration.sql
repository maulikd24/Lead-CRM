-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('OK', 'ABSTAINED', 'FAILED', 'BLOCKED');

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "agentKey" TEXT,
    "purposeId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "promptHash" TEXT,
    "inputClass" TEXT NOT NULL,
    "redactionSummary" JSONB,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsdEstimate" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "status" "AgentRunStatus" NOT NULL,
    "reasonCode" TEXT,
    "errorClass" TEXT,
    "evalOutcome" TEXT,
    "approvalRef" TEXT,
    "correlationId" TEXT NOT NULL,
    "causationId" TEXT,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "retainUntil" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRunRollup" (
    "day" DATE NOT NULL,
    "agentKey" TEXT NOT NULL DEFAULT '',
    "purposeId" TEXT NOT NULL,
    "status" "AgentRunStatus" NOT NULL,
    "runs" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" BIGINT NOT NULL DEFAULT 0,
    "outputTokens" BIGINT NOT NULL DEFAULT 0,
    "costUsdEstimate" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "latencyMsTotal" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "AgentRunRollup_pkey" PRIMARY KEY ("day","agentKey","purposeId","status")
);

-- CreateTable
CREATE TABLE "AgentAutonomy" (
    "agentKey" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "reason" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentAutonomy_pkey" PRIMARY KEY ("agentKey","actionType")
);

-- CreateIndex
CREATE INDEX "AgentRun_createdAt_idx" ON "AgentRun"("createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_purposeId_createdAt_idx" ON "AgentRun"("purposeId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_agentKey_createdAt_idx" ON "AgentRun"("agentKey", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_correlationId_idx" ON "AgentRun"("correlationId");

-- CreateIndex
CREATE INDEX "AgentRun_retainUntil_idx" ON "AgentRun"("retainUntil");
