-- Wave 2 workstream B: customer memory, complaints, commitments, household relationship consent. Additive only: six new tables, six enums,
-- their indexes and foreign keys to Client and Household. No existing table or column is changed.

-- CreateEnum
CREATE TYPE "MemoryClass" AS ENUM ('FACT', 'PREFERENCE', 'INTEREST', 'OBJECTION', 'COMMITMENT', 'GOAL', 'SENTIMENT', 'PRODUCT_STANCE', 'SERVICE_CONTEXT', 'DO_NOT_DO');

-- CreateEnum
CREATE TYPE "MemoryConfirmation" AS ENUM ('UNCONFIRMED', 'CONFIRMED', 'DISPUTED', 'REJECTED', 'EXPIRED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "MemoryConfidence" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "ComplaintSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ComplaintStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'REOPENED', 'CLOSED');

-- CreateEnum
CREATE TYPE "CommitmentStatus" AS ENUM ('OPEN', 'KEPT', 'BROKEN', 'CANCELLED');

-- CreateTable
CREATE TABLE "CustomerMemoryItem" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "class" "MemoryClass" NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "confidence" "MemoryConfidence" NOT NULL DEFAULT 'LOW',
    "observedAt" TIMESTAMP(3) NOT NULL,
    "freshUntil" TIMESTAMP(3),
    "lastReconfirmedAt" TIMESTAMP(3),
    "confirmation" "MemoryConfirmation" NOT NULL DEFAULT 'UNCONFIRMED',
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "disputedById" TEXT,
    "disputedAt" TIMESTAMP(3),
    "disputedReason" TEXT,
    "conflictsWithId" TEXT,
    "supersededById" TEXT,
    "dataClass" TEXT NOT NULL DEFAULT 'PERSONAL',
    "consentBasis" TEXT,
    "createdByType" TEXT NOT NULL,
    "createdById" TEXT,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerMemoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Complaint" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "severity" "ComplaintSeverity" NOT NULL,
    "status" "ComplaintStatus" NOT NULL DEFAULT 'OPEN',
    "ownerId" TEXT,
    "sourceType" TEXT NOT NULL,
    "supportTicketId" TEXT,
    "insightId" TEXT,
    "reviewId" TEXT,
    "taskId" TEXT,
    "dedupeKey" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "acknowledgedAt" TIMESTAMP(3),
    "slaDueAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "reopenedCount" INTEGER NOT NULL DEFAULT 0,
    "lastReopenedAt" TIMESTAMP(3),
    "resolutionCode" TEXT,
    "resolution" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Complaint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplaintEvent" (
    "id" TEXT NOT NULL,
    "complaintId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fromStatus" "ComplaintStatus",
    "toStatus" "ComplaintStatus",
    "actorId" TEXT,
    "note" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplaintEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Commitment" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "promisedByType" TEXT NOT NULL,
    "promisedById" TEXT,
    "promisedToType" TEXT NOT NULL DEFAULT 'CUSTOMER',
    "text" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "CommitmentStatus" NOT NULL DEFAULT 'OPEN',
    "ownerId" TEXT,
    "sourceType" TEXT NOT NULL,
    "insightId" TEXT,
    "reviewId" TEXT,
    "taskId" TEXT,
    "memoryItemId" TEXT,
    "dedupeKey" TEXT,
    "keptAt" TIMESTAMP(3),
    "brokenAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "outcomeNote" TEXT,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Commitment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HouseholdRelationshipConsent" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "subjectClientId" TEXT NOT NULL,
    "granteeClientId" TEXT,
    "scopes" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "evidenceRef" TEXT,
    "capturedById" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HouseholdRelationshipConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerMemoryItem_clientId_class_confirmation_idx" ON "CustomerMemoryItem"("clientId", "class", "confirmation");

-- CreateIndex
CREATE INDEX "CustomerMemoryItem_clientId_key_idx" ON "CustomerMemoryItem"("clientId", "key");

-- CreateIndex
CREATE INDEX "CustomerMemoryItem_confirmation_freshUntil_idx" ON "CustomerMemoryItem"("confirmation", "freshUntil");

-- CreateIndex
CREATE UNIQUE INDEX "Complaint_dedupeKey_key" ON "Complaint"("dedupeKey");

-- CreateIndex
CREATE INDEX "Complaint_clientId_status_idx" ON "Complaint"("clientId", "status");

-- CreateIndex
CREATE INDEX "Complaint_status_slaDueAt_idx" ON "Complaint"("status", "slaDueAt");

-- CreateIndex
CREATE INDEX "Complaint_ownerId_status_idx" ON "Complaint"("ownerId", "status");

-- CreateIndex
CREATE INDEX "ComplaintEvent_complaintId_at_idx" ON "ComplaintEvent"("complaintId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "Commitment_dedupeKey_key" ON "Commitment"("dedupeKey");

-- CreateIndex
CREATE INDEX "Commitment_clientId_status_idx" ON "Commitment"("clientId", "status");

-- CreateIndex
CREATE INDEX "Commitment_status_dueAt_idx" ON "Commitment"("status", "dueAt");

-- CreateIndex
CREATE INDEX "Commitment_ownerId_status_idx" ON "Commitment"("ownerId", "status");

-- CreateIndex
CREATE INDEX "HouseholdRelationshipConsent_householdId_subjectClientId_gr_idx" ON "HouseholdRelationshipConsent"("householdId", "subjectClientId", "granteeClientId", "capturedAt" DESC);

-- CreateIndex
CREATE INDEX "HouseholdRelationshipConsent_subjectClientId_idx" ON "HouseholdRelationshipConsent"("subjectClientId");

-- CreateIndex
CREATE INDEX "HouseholdRelationshipConsent_granteeClientId_idx" ON "HouseholdRelationshipConsent"("granteeClientId");

-- AddForeignKey
ALTER TABLE "CustomerMemoryItem" ADD CONSTRAINT "CustomerMemoryItem_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplaintEvent" ADD CONSTRAINT "ComplaintEvent_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commitment" ADD CONSTRAINT "Commitment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseholdRelationshipConsent" ADD CONSTRAINT "HouseholdRelationshipConsent_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseholdRelationshipConsent" ADD CONSTRAINT "HouseholdRelationshipConsent_subjectClientId_fkey" FOREIGN KEY ("subjectClientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseholdRelationshipConsent" ADD CONSTRAINT "HouseholdRelationshipConsent_granteeClientId_fkey" FOREIGN KEY ("granteeClientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
