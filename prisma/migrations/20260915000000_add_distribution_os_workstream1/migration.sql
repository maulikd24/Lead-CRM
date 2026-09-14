-- AlterEnum: additive Role values (existing 4 values and all their behavior are unchanged)
ALTER TYPE "Role" ADD VALUE 'TEAM_MANAGER';
ALTER TYPE "Role" ADD VALUE 'PARTNER';
ALTER TYPE "Role" ADD VALUE 'AFFILIATE';
ALTER TYPE "Role" ADD VALUE 'DISTRIBUTOR';
ALTER TYPE "Role" ADD VALUE 'FINANCE';

-- AlterTable
ALTER TABLE "User" ADD COLUMN "lastLoginAt" TIMESTAMP(3);

-- CreateEnum
CREATE TYPE "TeamType" AS ENUM ('RM_TEAM', 'PARTNER_TEAM', 'DISTRIBUTOR_NETWORK', 'FINANCE_OPS', 'MANAGEMENT');

-- CreateEnum
CREATE TYPE "PartnerType" AS ENUM ('PARTNER', 'AFFILIATE', 'DISTRIBUTOR');

-- CreateEnum
CREATE TYPE "PartnerTier" AS ENUM ('BRONZE', 'SILVER', 'GOLD', 'PLATINUM');

-- CreateEnum
CREATE TYPE "EmpanelmentStatus" AS ENUM ('ONBOARDING', 'ACTIVE', 'SUSPENDED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "HierarchyRelationType" AS ENUM ('MANAGES_TEAM', 'TEAM_MEMBER', 'SERVICING_RM', 'SUB_PARTNER_OF');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_code_key" ON "Company"("code");

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "TeamType" NOT NULL,
    "teamManagerId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Team_code_key" ON "Team"("code");

-- CreateIndex
CREATE INDEX "Team_companyId_idx" ON "Team"("companyId");

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_teamManagerId_fkey" FOREIGN KEY ("teamManagerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "PartnerProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "partnerCode" TEXT NOT NULL,
    "partnerType" "PartnerType" NOT NULL,
    "tier" "PartnerTier" NOT NULL DEFAULT 'BRONZE',
    "empanelmentStatus" "EmpanelmentStatus" NOT NULL DEFAULT 'ONBOARDING',
    "empanelmentDate" TIMESTAMP(3),
    "region" TEXT,
    "arnCode" TEXT,
    "euinCode" TEXT,
    "gstin" TEXT,
    "panNumber" TEXT,
    "bankAccountLast4" TEXT,
    "bankVerifiedAt" TIMESTAMP(3),
    "parentPartnerProfileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartnerProfile_userId_key" ON "PartnerProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerProfile_partnerCode_key" ON "PartnerProfile"("partnerCode");

-- CreateIndex
CREATE INDEX "PartnerProfile_partnerType_empanelmentStatus_idx" ON "PartnerProfile"("partnerType", "empanelmentStatus");

-- CreateIndex
CREATE INDEX "PartnerProfile_parentPartnerProfileId_idx" ON "PartnerProfile"("parentPartnerProfileId");

-- AddForeignKey
ALTER TABLE "PartnerProfile" ADD CONSTRAINT "PartnerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerProfile" ADD CONSTRAINT "PartnerProfile_parentPartnerProfileId_fkey" FOREIGN KEY ("parentPartnerProfileId") REFERENCES "PartnerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "HierarchyAssignment" (
    "id" TEXT NOT NULL,
    "relationType" "HierarchyRelationType" NOT NULL,
    "assigneeUserId" TEXT,
    "assigneePartnerId" TEXT,
    "parentUserId" TEXT,
    "parentPartnerId" TEXT,
    "teamId" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "HierarchyAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HierarchyAssignment_assigneeUserId_validFrom_validTo_idx" ON "HierarchyAssignment"("assigneeUserId", "validFrom", "validTo");

-- CreateIndex
CREATE INDEX "HierarchyAssignment_assigneePartnerId_validFrom_validTo_idx" ON "HierarchyAssignment"("assigneePartnerId", "validFrom", "validTo");

-- CreateIndex
CREATE INDEX "HierarchyAssignment_parentUserId_validFrom_validTo_idx" ON "HierarchyAssignment"("parentUserId", "validFrom", "validTo");

-- CreateIndex
CREATE INDEX "HierarchyAssignment_parentPartnerId_validFrom_validTo_idx" ON "HierarchyAssignment"("parentPartnerId", "validFrom", "validTo");

-- CreateIndex
CREATE INDEX "HierarchyAssignment_teamId_idx" ON "HierarchyAssignment"("teamId");

-- AddForeignKey
ALTER TABLE "HierarchyAssignment" ADD CONSTRAINT "HierarchyAssignment_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HierarchyAssignment" ADD CONSTRAINT "HierarchyAssignment_assigneePartnerId_fkey" FOREIGN KEY ("assigneePartnerId") REFERENCES "PartnerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HierarchyAssignment" ADD CONSTRAINT "HierarchyAssignment_parentUserId_fkey" FOREIGN KEY ("parentUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HierarchyAssignment" ADD CONSTRAINT "HierarchyAssignment_parentPartnerId_fkey" FOREIGN KEY ("parentPartnerId") REFERENCES "PartnerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HierarchyAssignment" ADD CONSTRAINT "HierarchyAssignment_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HierarchyAssignment" ADD CONSTRAINT "HierarchyAssignment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "reason" TEXT,
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "expiresAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRequest_idempotencyKey_key" ON "ApprovalRequest"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ApprovalRequest_status_actionType_idx" ON "ApprovalRequest"("status", "actionType");

-- CreateIndex
CREATE INDEX "ApprovalRequest_entity_entityId_idx" ON "ApprovalRequest"("entity", "entityId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_requestedById_idx" ON "ApprovalRequest"("requestedById");

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "DataAccessLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "accessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,

    CONSTRAINT "DataAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DataAccessLog_entity_entityId_idx" ON "DataAccessLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "DataAccessLog_userId_accessedAt_idx" ON "DataAccessLog"("userId", "accessedAt");

-- AddForeignKey
ALTER TABLE "DataAccessLog" ADD CONSTRAINT "DataAccessLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
