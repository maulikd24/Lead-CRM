-- CreateEnum
CREATE TYPE "AgentProposalStatus" AS ENUM ('DRAFT', 'APPROVED', 'SENT', 'REJECTED', 'EXPIRED', 'BLOCKED');

-- CreateTable
CREATE TABLE "AgentProposal" (
    "id" TEXT NOT NULL,
    "agentKey" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "programme" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'whatsapp',
    "body" TEXT NOT NULL,
    "originalBody" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "AgentProposalStatus" NOT NULL DEFAULT 'DRAFT',
    "blockedReason" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "messageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentSetting" (
    "agentKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentSetting_pkey" PRIMARY KEY ("agentKey")
);

-- CreateIndex
CREATE INDEX "AgentProposal_status_createdAt_idx" ON "AgentProposal"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AgentProposal_clientId_createdAt_idx" ON "AgentProposal"("clientId", "createdAt");

-- AddForeignKey
ALTER TABLE "AgentProposal" ADD CONSTRAINT "AgentProposal_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentProposal" ADD CONSTRAINT "AgentProposal_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
