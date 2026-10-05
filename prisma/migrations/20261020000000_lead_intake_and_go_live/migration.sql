-- Lead intake ledger, campaign attribution/consent on Client, cron heartbeat and go-live checklist ticks.

-- CreateEnum
CREATE TYPE "LeadIntakeStatus" AS ENUM ('CREATED', 'DUPLICATE', 'REJECTED', 'ERROR');

-- AlterTable
ALTER TABLE "Client" ADD COLUMN "leadAttribution" JSONB,
ADD COLUMN "marketingConsentAt" TIMESTAMP(3),
ADD COLUMN "marketingConsentText" TEXT;

-- CreateTable
CREATE TABLE "LeadIntake" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "status" "LeadIntakeStatus" NOT NULL,
    "clientId" TEXT,
    "rawPayload" JSONB NOT NULL,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "LeadIntake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemHeartbeat" (
    "key" TEXT NOT NULL,
    "lastAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemHeartbeat_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "GoLiveCheck" (
    "itemId" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "doneById" TEXT,
    "doneAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoLiveCheck_pkey" PRIMARY KEY ("itemId")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeadIntake_source_externalId_key" ON "LeadIntake"("source", "externalId");

-- CreateIndex
CREATE INDEX "LeadIntake_status_receivedAt_idx" ON "LeadIntake"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "LeadIntake_source_receivedAt_idx" ON "LeadIntake"("source", "receivedAt");
