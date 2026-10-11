-- Customer events (Wave 1, workstream A). Additive only: five new tables, their indexes and one foreign key between two of the new tables (dead letter -> event). No existing table is touched.
-- CustomerEvent.clientId is a plain id on purpose (no foreign key): the fact outlives the customer's erasure.


-- CreateTable
CREATE TABLE "CustomerEvent" (
    "id" TEXT NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "clientId" TEXT,
    "source" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "causationId" TEXT,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "consentContext" JSONB,
    "metadata" JSONB,
    "dataClass" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "late" BOOLEAN NOT NULL DEFAULT false,
    "clockSkew" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CustomerEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventCursor" (
    "consumer" TEXT NOT NULL,
    "lastSeq" BIGINT NOT NULL DEFAULT 0,
    "lastReceivedAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "lastError" TEXT,
    "processedTotal" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventCursor_pkey" PRIMARY KEY ("consumer")
);

-- CreateTable
CREATE TABLE "EventDeadLetter" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "consumer" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'RETRYING',
    "errorClass" TEXT,
    "errorMessage" TEXT,
    "firstFailedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastFailedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "EventDeadLetter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventEmitFailure" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "clientId" TEXT,
    "reason" TEXT NOT NULL,
    "detail" TEXT,
    "envelope" JSONB,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAttemptAt" TIMESTAMP(3),

    CONSTRAINT "EventEmitFailure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataHealthItem" (
    "id" TEXT NOT NULL,
    "checkKey" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "clientId" TEXT,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" JSONB,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "acknowledgedById" TEXT,
    "acknowledgedAt" TIMESTAMP(3),

    CONSTRAINT "DataHealthItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerEvent_seq_key" ON "CustomerEvent"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerEvent_eventId_key" ON "CustomerEvent"("eventId");

-- CreateIndex
CREATE INDEX "CustomerEvent_clientId_occurredAt_idx" ON "CustomerEvent"("clientId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "CustomerEvent_eventType_occurredAt_idx" ON "CustomerEvent"("eventType", "occurredAt");

-- CreateIndex
CREATE INDEX "CustomerEvent_correlationId_idx" ON "CustomerEvent"("correlationId");

-- CreateIndex
CREATE INDEX "CustomerEvent_receivedAt_idx" ON "CustomerEvent"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerEvent_source_dedupeKey_key" ON "CustomerEvent"("source", "dedupeKey");

-- CreateIndex
CREATE INDEX "EventDeadLetter_status_lastFailedAt_idx" ON "EventDeadLetter"("status", "lastFailedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EventDeadLetter_eventId_consumer_key" ON "EventDeadLetter"("eventId", "consumer");

-- CreateIndex
CREATE INDEX "EventEmitFailure_status_createdAt_idx" ON "EventEmitFailure"("status", "createdAt");

-- CreateIndex
CREATE INDEX "EventEmitFailure_clientId_idx" ON "EventEmitFailure"("clientId");

-- CreateIndex
CREATE INDEX "DataHealthItem_status_severity_idx" ON "DataHealthItem"("status", "severity");

-- CreateIndex
CREATE INDEX "DataHealthItem_clientId_idx" ON "DataHealthItem"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "DataHealthItem_checkKey_subjectType_subjectId_key" ON "DataHealthItem"("checkKey", "subjectType", "subjectId");

-- AddForeignKey
ALTER TABLE "EventDeadLetter" ADD CONSTRAINT "EventDeadLetter_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CustomerEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

