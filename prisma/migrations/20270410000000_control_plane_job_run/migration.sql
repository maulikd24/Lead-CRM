-- Admin control plane, first slice. Additive only: two new tables and their indexes; no foreign key, no change to any existing table.

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "tickId" TEXT,
    "status" TEXT NOT NULL,
    "skipReason" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "retryOfId" TEXT,
    "errorClass" TEXT,
    "errorMessage" TEXT,
    "summary" JSONB,
    "trigger" TEXT,
    "deployRef" TEXT,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ControlPlaneAlert" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" JSONB,
    "firstRaisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),
    "acknowledgedById" TEXT,
    "acknowledgedAt" TIMESTAMP(3),

    CONSTRAINT "ControlPlaneAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobRun_job_startedAt_idx" ON "JobRun"("job", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "JobRun_status_startedAt_idx" ON "JobRun"("status", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "JobRun_tickId_idx" ON "JobRun"("tickId");

-- CreateIndex
CREATE INDEX "JobRun_startedAt_idx" ON "JobRun"("startedAt");

-- CreateIndex
CREATE INDEX "ControlPlaneAlert_resolvedAt_severity_idx" ON "ControlPlaneAlert"("resolvedAt", "severity");

-- CreateIndex
CREATE INDEX "ControlPlaneAlert_key_idx" ON "ControlPlaneAlert"("key");
