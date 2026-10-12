-- Portfolio feed: sender's monotonic row version, so a late replay cannot undo a correction. Additive, nullable.
ALTER TABLE "Position" ADD COLUMN "feedRevision" INTEGER;
ALTER TABLE "Transaction" ADD COLUMN "feedRevision" INTEGER;
