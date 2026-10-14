-- CreateEnum
CREATE TYPE "AuditFindingSource" AS ENUM ('WHATSAPP', 'CALL', 'SUPPORT', 'RM_COMMUNICATION', 'COMPLAINT', 'COMPLIANCE', 'COMMITMENT', 'MANUAL');

-- CreateEnum
CREATE TYPE "AuditFindingCategory" AS ENUM ('INCORRECT_COMMUNICATION', 'POOR_CONVERSATION', 'MISSED_FOLLOW_UP', 'MISSED_OPPORTUNITY', 'CUSTOMER_DISSATISFACTION', 'COMMITMENT_NOT_COMPLETED', 'POTENTIAL_COMPLIANCE_ISSUE');

-- CreateEnum
CREATE TYPE "AuditFindingSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "AuditFindingStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED');

-- CreateTable
CREATE TABLE "AuditFinding" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "subjectUserId" TEXT,
    "source" "AuditFindingSource" NOT NULL,
    "category" "AuditFindingCategory" NOT NULL,
    "severity" "AuditFindingSeverity" NOT NULL,
    "status" "AuditFindingStatus" NOT NULL DEFAULT 'OPEN',
    "summary" TEXT NOT NULL,
    "evidenceRef" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditFinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuditFinding_dedupeKey_key" ON "AuditFinding"("dedupeKey");

-- CreateIndex
CREATE INDEX "AuditFinding_clientId_status_idx" ON "AuditFinding"("clientId", "status");

-- CreateIndex
CREATE INDEX "AuditFinding_status_severity_idx" ON "AuditFinding"("status", "severity");

-- AddForeignKey
ALTER TABLE "AuditFinding" ADD CONSTRAINT "AuditFinding_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditFinding" ADD CONSTRAINT "AuditFinding_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditFinding" ADD CONSTRAINT "AuditFinding_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
