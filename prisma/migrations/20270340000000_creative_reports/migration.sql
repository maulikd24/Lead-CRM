-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'MARKETING';

-- CreateTable
CREATE TABLE "CreativeBrief" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "hookType" TEXT NOT NULL,
    "usp" TEXT,
    "cta" TEXT,
    "master" JSONB NOT NULL,
    "formats" TEXT[],
    "referenceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "brandVersion" INTEGER,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreativeBrief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreativeVariant" (
    "id" TEXT NOT NULL,
    "briefId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "fields" JSONB NOT NULL,
    "disclaimer" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "source" TEXT NOT NULL DEFAULT 'STAFF',
    "complianceStatus" TEXT NOT NULL DEFAULT 'FAIL',
    "complianceChecks" JSONB,
    "score" INTEGER,
    "verdict" TEXT,
    "authorId" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreativeVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreativeEvent" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "actorId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreativeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreativeTag" (
    "id" TEXT NOT NULL,
    "adKey" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "adId" TEXT NOT NULL,
    "adName" TEXT,
    "tagType" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "source" TEXT NOT NULL DEFAULT 'HUMAN',
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreativeTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandProfileVersion" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "profile" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrandProfileVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorWatch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pageId" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitorWatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorAd" (
    "id" TEXT NOT NULL,
    "competitorId" TEXT NOT NULL,
    "copy" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "startDate" DATE,
    "link" TEXT,
    "thumbnailRef" TEXT,
    "hookTag" TEXT,
    "offerTag" TEXT,
    "tagStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "tagSource" TEXT NOT NULL DEFAULT 'RULE',
    "importedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitorAd_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Experiment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "baselineRate" DOUBLE PRECISION,
    "mde" DOUBLE PRECISION,
    "mdeKind" TEXT NOT NULL DEFAULT 'relative',
    "visitorsPerDay" INTEGER,
    "sampleSizePerArm" INTEGER,
    "startAt" DATE,
    "endAt" DATE,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "decision" TEXT,
    "learning" TEXT,
    "campaignIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Experiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportShare" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT,
    "periodFrom" DATE NOT NULL,
    "periodTo" DATE NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "lastViewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DirectorDigest" (
    "id" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "report" JSONB NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "recipients" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DirectorDigest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreativeSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreativeSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "CreativeBrief_createdAt_idx" ON "CreativeBrief"("createdAt");

-- CreateIndex
CREATE INDEX "CreativeVariant_briefId_idx" ON "CreativeVariant"("briefId");

-- CreateIndex
CREATE INDEX "CreativeVariant_status_updatedAt_idx" ON "CreativeVariant"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "CreativeEvent_variantId_createdAt_idx" ON "CreativeEvent"("variantId", "createdAt");

-- CreateIndex
CREATE INDEX "CreativeTag_channel_idx" ON "CreativeTag"("channel");

-- CreateIndex
CREATE UNIQUE INDEX "CreativeTag_adKey_tagType_key" ON "CreativeTag"("adKey", "tagType");

-- CreateIndex
CREATE UNIQUE INDEX "BrandProfileVersion_version_key" ON "BrandProfileVersion"("version");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitorWatch_name_key" ON "CompetitorWatch"("name");

-- CreateIndex
CREATE INDEX "CompetitorAd_competitorId_startDate_idx" ON "CompetitorAd"("competitorId", "startDate");

-- CreateIndex
CREATE INDEX "Experiment_status_updatedAt_idx" ON "Experiment"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReportShare_tokenHash_key" ON "ReportShare"("tokenHash");

-- CreateIndex
CREATE INDEX "ReportShare_expiresAt_idx" ON "ReportShare"("expiresAt");

-- CreateIndex
CREATE INDEX "ReportShare_createdAt_idx" ON "ReportShare"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DirectorDigest_weekStart_key" ON "DirectorDigest"("weekStart");

-- CreateIndex
CREATE INDEX "DirectorDigest_status_createdAt_idx" ON "DirectorDigest"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "CreativeVariant" ADD CONSTRAINT "CreativeVariant_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "CreativeBrief"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreativeEvent" ADD CONSTRAINT "CreativeEvent_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "CreativeVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorAd" ADD CONSTRAINT "CompetitorAd_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "CompetitorWatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
