-- One identity rule for every lead source (src/lib/clients/identity-keys.ts), plus Freshdesk ticket sync.

-- AlterTable
ALTER TABLE "Client" ADD COLUMN "mobileKey" TEXT,
ADD COLUMN "emailKey" TEXT,
ADD COLUMN "freshdeskSyncedAt" TIMESTAMP(3),
ADD COLUMN "freshdeskSyncKey" TEXT;

-- AlterTable
ALTER TABLE "AccountHolder" ADD COLUMN "mobileKey" TEXT,
ADD COLUMN "emailKey" TEXT;

-- Backfill. MUST mirror phoneKey()/emailKey() exactly:
--   digits only; drop a leading "00"; 13 digits "910…" → last 10; 12 digits "91…" → last 10; 11 digits "0…" → last 10;
--   8+ digits → as-is; shorter → NULL. Email: trimmed, lower-cased, NULL if empty.
UPDATE "Client" c SET "mobileKey" = k.key
FROM (
  SELECT id, CASE
    WHEN length(d) = 13 AND d LIKE '910%' THEN substr(d, 4)
    WHEN length(d) = 12 AND d LIKE '91%' THEN substr(d, 3)
    WHEN length(d) = 11 AND d LIKE '0%' THEN substr(d, 2)
    WHEN length(d) >= 8 THEN d
    ELSE NULL END AS key
  FROM (
    SELECT id, CASE WHEN raw LIKE '00%' THEN substr(raw, 3) ELSE raw END AS d
    FROM (SELECT id, regexp_replace(mobile, '[^0-9]', '', 'g') AS raw FROM "Client" WHERE mobile IS NOT NULL) a
  ) b
) k
WHERE c.id = k.id;

UPDATE "AccountHolder" h SET "mobileKey" = k.key
FROM (
  SELECT id, CASE
    WHEN length(d) = 13 AND d LIKE '910%' THEN substr(d, 4)
    WHEN length(d) = 12 AND d LIKE '91%' THEN substr(d, 3)
    WHEN length(d) = 11 AND d LIKE '0%' THEN substr(d, 2)
    WHEN length(d) >= 8 THEN d
    ELSE NULL END AS key
  FROM (
    SELECT id, CASE WHEN raw LIKE '00%' THEN substr(raw, 3) ELSE raw END AS d
    FROM (SELECT id, regexp_replace(mobile, '[^0-9]', '', 'g') AS raw FROM "AccountHolder" WHERE mobile IS NOT NULL) a
  ) b
) k
WHERE h.id = k.id;

UPDATE "Client" SET "emailKey" = NULLIF(lower(btrim(email)), '') WHERE email IS NOT NULL;
UPDATE "AccountHolder" SET "emailKey" = NULLIF(lower(btrim(email)), '') WHERE email IS NOT NULL;

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "subject" TEXT,
    "status" TEXT,
    "priority" TEXT,
    "channel" TEXT,
    "ticketCreatedAt" TIMESTAMP(3),
    "ticketUpdatedAt" TIMESTAMP(3),
    "activityId" TEXT,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Client_mobileKey_idx" ON "Client"("mobileKey");
CREATE INDEX "Client_emailKey_idx" ON "Client"("emailKey");
CREATE INDEX "AccountHolder_mobileKey_idx" ON "AccountHolder"("mobileKey");
CREATE INDEX "AccountHolder_emailKey_idx" ON "AccountHolder"("emailKey");
CREATE UNIQUE INDEX "SupportTicket_provider_externalId_key" ON "SupportTicket"("provider", "externalId");
CREATE INDEX "SupportTicket_clientId_ticketCreatedAt_idx" ON "SupportTicket"("clientId", "ticketCreatedAt");

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
