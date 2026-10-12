-- Referral clawbacks. Additive only: one optional column on the rule (the window, in days) and one on the ledger entry
-- (the end of that accrual's window, fixed when it accrued). The new ledger kinds (CLAWBACK, CLAWBACK_WAIVED) need no
-- schema change: the kind column is text. The append-only trigger still applies to every row.
ALTER TABLE "RewardRule" ADD COLUMN "clawbackDays" INTEGER;
ALTER TABLE "RewardLedgerEntry" ADD COLUMN "clawbackUntil" TIMESTAMP(3);
