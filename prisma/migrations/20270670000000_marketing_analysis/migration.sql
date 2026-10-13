-- CreateTable
CREATE TABLE "MarketingAnalysis" (
    "id" TEXT NOT NULL,
    "rangeFrom" TEXT NOT NULL,
    "rangeTo" TEXT NOT NULL,
    "currency" TEXT,
    "source" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "body" TEXT NOT NULL,
    "note" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketingAnalysis_createdAt_idx" ON "MarketingAnalysis"("createdAt");
