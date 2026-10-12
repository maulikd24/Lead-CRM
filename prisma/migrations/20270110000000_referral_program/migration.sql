
-- CreateTable
CREATE TABLE "Referrer" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Referrer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralCode" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "revokeReason" TEXT,

    CONSTRAINT "ReferralCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "referrerId" TEXT,
    "codeId" TEXT,
    "referredClientId" TEXT,
    "outcome" TEXT NOT NULL,
    "reason" TEXT,
    "attributedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralEvent" (
    "id" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "amountPaise" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fixedPaise" INTEGER,
    "percentBps" INTEGER,
    "maxRewardPaise" INTEGER,
    "capPerReferrerMonthPaise" INTEGER,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardLedgerEntry" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "referralId" TEXT,
    "eventType" TEXT,
    "ruleId" TEXT,
    "refEntryId" TEXT,
    "statementId" TEXT,
    "amountPaise" INTEGER NOT NULL,
    "periodMonth" TEXT NOT NULL,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "note" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardStatement" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREPARED',
    "totalPaise" INTEGER NOT NULL,
    "lines" JSONB NOT NULL,
    "preparedById" TEXT NOT NULL,
    "preparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidMarkedById" TEXT,
    "paidMarkedAt" TIMESTAMP(3),
    "bankReference" TEXT,

    CONSTRAINT "RewardStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Referrer_clientId_key" ON "Referrer"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralCode_code_key" ON "ReferralCode"("code");

-- CreateIndex
CREATE INDEX "ReferralCode_referrerId_idx" ON "ReferralCode"("referrerId");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_idempotencyKey_key" ON "Referral"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_referredClientId_key" ON "Referral"("referredClientId");

-- CreateIndex
CREATE INDEX "Referral_referrerId_attributedAt_idx" ON "Referral"("referrerId", "attributedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralEvent_referralId_type_key" ON "ReferralEvent"("referralId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "RewardLedgerEntry_idempotencyKey_key" ON "RewardLedgerEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "RewardLedgerEntry_referrerId_periodMonth_idx" ON "RewardLedgerEntry"("referrerId", "periodMonth");

-- CreateIndex
CREATE INDEX "RewardLedgerEntry_refEntryId_idx" ON "RewardLedgerEntry"("refEntryId");

-- CreateIndex
CREATE INDEX "RewardStatement_status_idx" ON "RewardStatement"("status");

-- CreateIndex
CREATE UNIQUE INDEX "RewardStatement_referrerId_period_key" ON "RewardStatement"("referrerId", "period");

-- AddForeignKey
ALTER TABLE "Referrer" ADD CONSTRAINT "Referrer_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralCode" ADD CONSTRAINT "ReferralCode_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "Referrer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "Referrer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referredClientId_fkey" FOREIGN KEY ("referredClientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralEvent" ADD CONSTRAINT "ReferralEvent_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The reward ledger is append-only: rows are never edited. (DELETE stays possible so a data-privacy erasure can remove a person's traces.)
CREATE OR REPLACE FUNCTION "reward_ledger_no_update"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'RewardLedgerEntry is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "RewardLedgerEntry_append_only"
BEFORE UPDATE ON "RewardLedgerEntry"
FOR EACH ROW EXECUTE FUNCTION "reward_ledger_no_update"();
