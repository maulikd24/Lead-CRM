-- Closed-loop conversions outbox. Additive only: one new table and its indexes. Holds hashed identifiers and event facts
-- (never a name, PAN, raw phone or raw email), and is deleted with the customer by the data-privacy erasure.
CREATE TABLE "ConversionOutbox" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "qualifier" TEXT NOT NULL DEFAULT '',
    "dedupId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "lastError" TEXT,
    "matched" BOOLEAN,
    "identity" JSONB NOT NULL,
    "value" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversionOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConversionOutbox_destination_dedupId_key" ON "ConversionOutbox"("destination", "dedupId");
CREATE INDEX "ConversionOutbox_status_nextAttemptAt_idx" ON "ConversionOutbox"("status", "nextAttemptAt");
CREATE INDEX "ConversionOutbox_clientId_idx" ON "ConversionOutbox"("clientId");
CREATE INDEX "ConversionOutbox_eventType_status_idx" ON "ConversionOutbox"("eventType", "status");

ALTER TABLE "ConversionOutbox" ADD CONSTRAINT "ConversionOutbox_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
