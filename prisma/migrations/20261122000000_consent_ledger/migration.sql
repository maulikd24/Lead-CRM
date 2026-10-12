-- Consent and do-not-contact ledger. Additive only: one new table, two indexes, one foreign key, guards on the new table.

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "channel" TEXT,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "noticeVersion" TEXT,
    "noticeTextHash" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "capturedById" TEXT,
    "evidenceRef" TEXT,
    "reason" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConsentRecord_clientId_purpose_channel_capturedAt_idx" ON "ConsentRecord"("clientId", "purpose", "channel", "capturedAt" DESC);

-- CreateIndex
CREATE INDEX "ConsentRecord_purpose_status_capturedAt_idx" ON "ConsentRecord"("purpose", "status", "capturedAt");

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Guards (not modelled by Prisma): the two statuses are the only ones, and a row can never be edited.
-- A change of mind is a new row. DELETE stays possible so an approved erasure request can remove a customer.
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_status_check" CHECK ("status" IN ('GRANTED', 'WITHDRAWN'));

CREATE FUNCTION consent_record_no_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ConsentRecord is append-only: record a new row instead of editing one';
END;
$$;

CREATE TRIGGER "ConsentRecord_no_update" BEFORE UPDATE ON "ConsentRecord"
  FOR EACH ROW EXECUTE FUNCTION consent_record_no_update();
