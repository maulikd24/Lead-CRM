-- Click-to-call. Additive only: the user's own calling number, and one row per call placed from Supportify (drives the live
-- call widget; removed with the client on erasure).
ALTER TABLE "User" ADD COLUMN "callPhone" TEXT;

CREATE TABLE "CallSession" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'exotel',
    "providerCallId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "activityId" TEXT,
    "mock" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CallSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CallSession_providerCallId_key" ON "CallSession"("providerCallId");
CREATE INDEX "CallSession_userId_startedAt_idx" ON "CallSession"("userId", "startedAt");
CREATE INDEX "CallSession_clientId_idx" ON "CallSession"("clientId");

ALTER TABLE "CallSession" ADD CONSTRAINT "CallSession_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CallSession" ADD CONSTRAINT "CallSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
