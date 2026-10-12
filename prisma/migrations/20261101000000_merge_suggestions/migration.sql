-- CreateTable
CREATE TABLE "MergeSuggestion" (
    "id" TEXT NOT NULL,
    "clientAId" TEXT NOT NULL,
    "clientBId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "reasons" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "MergeSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MergeSuggestion_status_score_idx" ON "MergeSuggestion"("status", "score");

-- CreateIndex
CREATE UNIQUE INDEX "MergeSuggestion_clientAId_clientBId_key" ON "MergeSuggestion"("clientAId", "clientBId");

-- AddForeignKey
ALTER TABLE "MergeSuggestion" ADD CONSTRAINT "MergeSuggestion_clientAId_fkey" FOREIGN KEY ("clientAId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MergeSuggestion" ADD CONSTRAINT "MergeSuggestion_clientBId_fkey" FOREIGN KEY ("clientBId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
