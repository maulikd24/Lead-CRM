-- CreateEnum
CREATE TYPE "WhatsAppAccountStatus" AS ENUM ('DISCONNECTED', 'QR_PENDING', 'CONNECTING', 'CONNECTED', 'FAILED');

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "accountId" TEXT,
ADD COLUMN     "claimedAt" TIMESTAMP(3),
ADD COLUMN     "mediaType" TEXT,
ADD COLUMN     "mediaUrl" TEXT,
ADD COLUMN     "origin" TEXT,
ADD COLUMN     "readAt" TIMESTAMP(3),
ADD COLUMN     "senderUserId" TEXT,
ADD COLUMN     "sentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "WhatsAppAccount" (
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
CREATE UNIQUE INDEX "WhatsAppAccount_sessionId_key" ON "WhatsAppAccount"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppAccount_ownerUserId_key" ON "WhatsAppAccount"("ownerUserId");

-- CreateIndex
CREATE INDEX "Message_accountId_createdAt_idx" ON "Message"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_status_accountId_idx" ON "Message"("status", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Message_accountId_externalId_key" ON "Message"("accountId", "externalId");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "WhatsAppAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppAccount" ADD CONSTRAINT "WhatsAppAccount_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
