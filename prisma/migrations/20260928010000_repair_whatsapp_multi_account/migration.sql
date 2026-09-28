-- Idempotent repair of 20260928000000_add_whatsapp_multi_account.
--
-- Production logged that migration as applied yet the WhatsAppAccount table did not exist when the app queried it
-- (through Prisma Postgres' pooled connection). Every statement below is guarded, so this is a no-op wherever the
-- original migration really took effect (including the local dev database) and creates whatever is missing elsewhere.

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WhatsAppAccountStatus') THEN
    CREATE TYPE "WhatsAppAccountStatus" AS ENUM ('DISCONNECTED', 'QR_PENDING', 'CONNECTING', 'CONNECTED', 'FAILED');
  END IF;
END $$;

-- AlterTable
ALTER TABLE "Message"
  ADD COLUMN IF NOT EXISTS "accountId" TEXT,
  ADD COLUMN IF NOT EXISTS "claimedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "mediaType" TEXT,
  ADD COLUMN IF NOT EXISTS "mediaUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "origin" TEXT,
  ADD COLUMN IF NOT EXISTS "readAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "senderUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "sentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE IF NOT EXISTS "WhatsAppAccount" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "phoneNumber" TEXT,
    "status" "WhatsAppAccountStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "qrDataUrl" TEXT,
    "qrUpdatedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "lastError" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppAccount_sessionId_key" ON "WhatsAppAccount"("sessionId");
CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppAccount_ownerUserId_key" ON "WhatsAppAccount"("ownerUserId");
CREATE INDEX IF NOT EXISTS "Message_accountId_createdAt_idx" ON "Message"("accountId", "createdAt");
CREATE INDEX IF NOT EXISTS "Message_status_accountId_idx" ON "Message"("status", "accountId");
CREATE UNIQUE INDEX IF NOT EXISTS "Message_accountId_externalId_key" ON "Message"("accountId", "externalId");

-- AddForeignKey (guarded: ADD CONSTRAINT has no IF NOT EXISTS)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Message_accountId_fkey') THEN
    ALTER TABLE "Message" ADD CONSTRAINT "Message_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "WhatsAppAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Message_senderUserId_fkey') THEN
    ALTER TABLE "Message" ADD CONSTRAINT "Message_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WhatsAppAccount_ownerUserId_fkey') THEN
    ALTER TABLE "WhatsAppAccount" ADD CONSTRAINT "WhatsAppAccount_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
