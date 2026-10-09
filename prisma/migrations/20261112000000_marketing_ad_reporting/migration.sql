-- CreateTable
CREATE TABLE "AdCampaignDaily" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "campaignName" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "spendMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "impressions" INTEGER NOT NULL,
    "clicks" INTEGER NOT NULL,
    "reach" INTEGER NOT NULL,
    "leads" INTEGER NOT NULL,
    "accountTimezone" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdCampaignDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdSyncRun" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "accountId" TEXT,
    "windowStart" DATE,
    "windowEnd" DATE,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "rowsUpserted" INTEGER NOT NULL DEFAULT 0,
    "campaignsSeen" INTEGER NOT NULL DEFAULT 0,
    "windowsOk" INTEGER NOT NULL DEFAULT 0,
    "windowsFailed" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AdSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdCampaignDaily_provider_accountId_date_idx" ON "AdCampaignDaily"("provider", "accountId", "date");

-- CreateIndex
CREATE INDEX "AdCampaignDaily_date_idx" ON "AdCampaignDaily"("date");

-- CreateIndex
CREATE UNIQUE INDEX "AdCampaignDaily_provider_accountId_campaignId_date_key" ON "AdCampaignDaily"("provider", "accountId", "campaignId", "date");

-- CreateIndex
CREATE INDEX "AdSyncRun_provider_startedAt_idx" ON "AdSyncRun"("provider", "startedAt");
