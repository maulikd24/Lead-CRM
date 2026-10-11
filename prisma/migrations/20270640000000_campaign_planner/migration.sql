-- CreateTable
CREATE TABLE "PlannerAudience" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "languages" TEXT[],
    "cities" TEXT[],
    "channels" TEXT[],
    "tone" TEXT NOT NULL,
    "productFit" TEXT NOT NULL,
    "objections" TEXT NOT NULL,
    "complianceNote" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlannerAudience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlannerDestination" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "urlPattern" TEXT NOT NULL,
    "ownerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "notes" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "lastCheckOk" BOOLEAN,
    "lastCheckMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlannerDestination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlannerPromise" (
    "id" TEXT NOT NULL,
    "hook" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "mentionsProduct" BOOLEAN NOT NULL DEFAULT false,
    "productRegistryId" TEXT,
    "destinationId" TEXT,
    "allowedClaims" TEXT[],
    "disallowedClaims" TEXT[],
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlannerPromise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlannerCreator" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "sebiRegistration" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlannerCreator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlannerPlan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "audienceId" TEXT NOT NULL,
    "promiseId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "destinationId" TEXT NOT NULL,
    "creatorId" TEXT,
    "budgetInr" INTEGER,
    "startDate" DATE,
    "endDate" DATE,
    "ownerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "consentPurpose" TEXT,
    "outcomeKey" TEXT,
    "linksTestedAt" TIMESTAMP(3),
    "linksTestedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlannerPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlannerCopy" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'STAFF',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "issues" JSONB,
    "createdById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlannerCopy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlannerEvent" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlannerEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlannerRoutingRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "cities" TEXT[],
    "languages" TEXT[],
    "products" TEXT[],
    "audienceKey" TEXT,
    "ownerId" TEXT,
    "ownerLabel" TEXT,
    "isFallback" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlannerRoutingRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlannerAudience_key_key" ON "PlannerAudience"("key");

-- CreateIndex
CREATE UNIQUE INDEX "PlannerPlan_code_key" ON "PlannerPlan"("code");

-- CreateIndex
CREATE INDEX "PlannerPlan_status_startDate_idx" ON "PlannerPlan"("status", "startDate");

-- CreateIndex
CREATE INDEX "PlannerPlan_audienceId_channel_idx" ON "PlannerPlan"("audienceId", "channel");

-- CreateIndex
CREATE INDEX "PlannerCopy_planId_createdAt_idx" ON "PlannerCopy"("planId", "createdAt");

-- CreateIndex
CREATE INDEX "PlannerEvent_planId_createdAt_idx" ON "PlannerEvent"("planId", "createdAt");

-- CreateIndex
CREATE INDEX "PlannerRoutingRule_enabled_priority_idx" ON "PlannerRoutingRule"("enabled", "priority");

-- AddForeignKey
ALTER TABLE "PlannerPromise" ADD CONSTRAINT "PlannerPromise_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "PlannerDestination"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlannerPlan" ADD CONSTRAINT "PlannerPlan_audienceId_fkey" FOREIGN KEY ("audienceId") REFERENCES "PlannerAudience"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlannerPlan" ADD CONSTRAINT "PlannerPlan_promiseId_fkey" FOREIGN KEY ("promiseId") REFERENCES "PlannerPromise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlannerPlan" ADD CONSTRAINT "PlannerPlan_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "PlannerDestination"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlannerPlan" ADD CONSTRAINT "PlannerPlan_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "PlannerCreator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlannerCopy" ADD CONSTRAINT "PlannerCopy_planId_fkey" FOREIGN KEY ("planId") REFERENCES "PlannerPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlannerEvent" ADD CONSTRAINT "PlannerEvent_planId_fkey" FOREIGN KEY ("planId") REFERENCES "PlannerPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
