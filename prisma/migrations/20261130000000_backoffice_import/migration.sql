-- CreateTable
CREATE TABLE "BackOfficeImportConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "mapping" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackOfficeImportConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackOfficeImportRun" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "counts" JSONB,
    "errors" JSONB,
    "userId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "BackOfficeImportRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BackOfficeImportRun_seq_key" ON "BackOfficeImportRun"("seq");

-- CreateIndex
CREATE INDEX "BackOfficeImportRun_checksum_kind_status_idx" ON "BackOfficeImportRun"("checksum", "kind", "status");

-- CreateIndex
CREATE INDEX "BackOfficeImportRun_startedAt_idx" ON "BackOfficeImportRun"("startedAt");
