-- AI reply-assist pilot (additive): the allowlist of people who may use the draft-only reply assistant, and the compliance
-- sign-off of the pilot wording. Two new tables, no change to any existing table, no data written. The AI provider key an
-- Admin enters in Settings is kept in the existing "IntegrationConfig" table (encrypted), so nothing is added for it.

-- CreateTable
CREATE TABLE "AiPilotUser" (
    "userId" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiPilotUser_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "AiPilotSignoff" (
    "id" TEXT NOT NULL,
    "statementVersion" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "acknowledgedById" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,

    CONSTRAINT "AiPilotSignoff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiPilotSignoff_acknowledgedAt_idx" ON "AiPilotSignoff"("acknowledgedAt");
