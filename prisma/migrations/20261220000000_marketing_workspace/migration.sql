-- CreateTable
CREATE TABLE "AdCreativeDaily" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "campaignName" TEXT NOT NULL,
    "adId" TEXT NOT NULL,
    "adName" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT '',
    "date" DATE NOT NULL,
    "spendMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "impressions" INTEGER NOT NULL,
    "clicks" INTEGER NOT NULL,
    "leads" INTEGER NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdCreativeDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialPost" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "source" TEXT NOT NULL DEFAULT 'STAFF',
    "scheduledFor" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "complianceIssues" JSONB,
    "brief" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialPostEvent" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "actorId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialPostEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdCreativeDaily_provider_accountId_date_idx" ON "AdCreativeDaily"("provider", "accountId", "date");

-- CreateIndex
CREATE INDEX "AdCreativeDaily_date_idx" ON "AdCreativeDaily"("date");

-- CreateIndex
CREATE UNIQUE INDEX "AdCreativeDaily_provider_accountId_adId_date_key" ON "AdCreativeDaily"("provider", "accountId", "adId", "date");

-- CreateIndex
CREATE INDEX "SocialPost_status_scheduledFor_idx" ON "SocialPost"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "SocialPost_createdAt_idx" ON "SocialPost"("createdAt");

-- CreateIndex
CREATE INDEX "SocialPostEvent_postId_createdAt_idx" ON "SocialPostEvent"("postId", "createdAt");

-- AddForeignKey
ALTER TABLE "SocialPostEvent" ADD CONSTRAINT "SocialPostEvent_postId_fkey" FOREIGN KEY ("postId") REFERENCES "SocialPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
