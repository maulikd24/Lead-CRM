-- Referral abuse signals and coexistence flags. Additive only: review flags and a hashed device on the referral, and a
-- small table of hashed devices seen on app signups (never the raw identifier), removed with the customer.
ALTER TABLE "Referral" ADD COLUMN "flags" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Referral" ADD COLUMN "deviceHash" TEXT;
CREATE INDEX "Referral_deviceHash_idx" ON "Referral"("deviceHash");

CREATE TABLE "ReferralDevice" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "deviceHash" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralDevice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReferralDevice_clientId_deviceHash_key" ON "ReferralDevice"("clientId", "deviceHash");
CREATE INDEX "ReferralDevice_deviceHash_idx" ON "ReferralDevice"("deviceHash");

ALTER TABLE "ReferralDevice" ADD CONSTRAINT "ReferralDevice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
