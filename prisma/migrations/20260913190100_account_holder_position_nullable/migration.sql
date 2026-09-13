-- AlterTable
-- position must be nullable so a removed (soft-deleted) holder can vacate its slot in the
-- non-partial @@unique([clientId, position]) index, letting a future holder reuse that position.
ALTER TABLE "AccountHolder" ALTER COLUMN "position" DROP NOT NULL;
