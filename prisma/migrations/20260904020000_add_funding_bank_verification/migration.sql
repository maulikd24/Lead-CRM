-- AlterTable
ALTER TABLE "FundingRecord" ADD COLUMN     "bankAccountLast4" TEXT,
ADD COLUMN     "bankAccountVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "bankVerifiedAt" TIMESTAMP(3);

