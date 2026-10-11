-- Campaign attribution (additive; flag NEXT_PUBLIC_ATTRIBUTION): the lead push (campaign context, speed-to-lead clock,
-- escalation) and the attribution settings. Customer-level attribution itself is computed from existing data and stores nothing.

-- CreateTable
CREATE TABLE "LeadPush" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "intakeKey" TEXT NOT NULL,
    "assignedToId" TEXT,
    "context" JSONB NOT NULL,
    "slaMinutes" INTEGER NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "contactedAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),
    "escalationTaskId" TEXT,
    "draftProposalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadPush_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttributionSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttributionSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeadPush_intakeKey_key" ON "LeadPush"("intakeKey");

-- CreateIndex
CREATE INDEX "LeadPush_status_dueAt_idx" ON "LeadPush"("status", "dueAt");

-- CreateIndex
CREATE INDEX "LeadPush_clientId_idx" ON "LeadPush"("clientId");

-- AddForeignKey
ALTER TABLE "LeadPush" ADD CONSTRAINT "LeadPush_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
