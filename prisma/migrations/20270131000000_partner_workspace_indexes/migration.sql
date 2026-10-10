-- Indexes for the Partner workspace's reads, chosen from EXPLAIN ANALYZE on a volume database (5,000 partners, 300,000 accruals,
-- 50,000 payout lines). All additive. See docs/partner-workspace.md, "Scale".

-- Attribution: a person's sourced account by partner, and counts per partner.
CREATE INDEX "TradingAccount_sourcingPartnerId_clientId_idx" ON "TradingAccount"("sourcingPartnerId", "clientId");

-- Statements and the overview read accruals by date range across partners.
CREATE INDEX "CommissionAccrual_accrualDate_idx" ON "CommissionAccrual"("accrualDate");

-- "Not yet in a payout run" is an anti-join from the accrual to its payout lines.
CREATE INDEX "PayoutLine_commissionAccrualId_idx" ON "PayoutLine"("commissionAccrualId");

-- A partner's payouts.
CREATE INDEX "Payout_partnerProfileId_idx" ON "Payout"("partnerProfileId");

-- A partner's adjustments by date, and the adjustments of a payout.
CREATE INDEX "CommissionAdjustment_partnerProfileId_createdAt_idx" ON "CommissionAdjustment"("partnerProfileId", "createdAt");
CREATE INDEX "CommissionAdjustment_payoutId_idx" ON "CommissionAdjustment"("payoutId");

-- Free-text referral source matched to a partner code without regard to case (attribution of a lead).
CREATE INDEX "Client_referralSource_upper_idx" ON "Client"(upper("referralSource")) WHERE "referralSource" IS NOT NULL AND "referralSource" <> '';
CREATE INDEX "PartnerProfile_partnerCode_upper_idx" ON "PartnerProfile"(upper("partnerCode"));
