-- CreateEnum
CREATE TYPE "ConversationSourceType" AS ENUM ('CALL', 'WHATSAPP_THREAD');

-- CreateEnum
CREATE TYPE "ConversationReviewStatus" AS ENUM ('PENDING_TRANSCRIPT', 'ANALYZING', 'ANALYZED', 'FAILED');

-- CreateTable
CREATE TABLE "ConversationReview" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "sourceType" "ConversationSourceType" NOT NULL,
    "sourceActivityId" TEXT,
    "coveredFromAt" TIMESTAMP(3),
    "coveredToAt" TIMESTAMP(3),
    "assignedRmId" TEXT,
    "status" "ConversationReviewStatus" NOT NULL DEFAULT 'PENDING_TRANSCRIPT',
    "exotelCallSid" TEXT,
    "transcript" TEXT,
    "sentimentLabel" TEXT,
    "sentimentScore" DOUBLE PRECISION,
    "sentimentReasoning" TEXT,
    "qualityScore" INTEGER,
    "qualityBreakdown" JSONB,
    "recommendationText" TEXT,
    "recommendationKind" TEXT,
    "recommendationDueAt" TIMESTAMP(3),
    "aiModel" TEXT,
    "aiRawResponse" JSONB,
    "analyzedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "overriddenScore" INTEGER,
    "taskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConversationReview_sourceActivityId_key" ON "ConversationReview"("sourceActivityId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationReview_taskId_key" ON "ConversationReview"("taskId");

-- CreateIndex
CREATE INDEX "ConversationReview_clientId_createdAt_idx" ON "ConversationReview"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "ConversationReview_status_idx" ON "ConversationReview"("status");

-- CreateIndex
CREATE INDEX "ConversationReview_assignedRmId_createdAt_idx" ON "ConversationReview"("assignedRmId", "createdAt");

-- CreateIndex
CREATE INDEX "ConversationReview_sourceType_sourceActivityId_idx" ON "ConversationReview"("sourceType", "sourceActivityId");

-- CreateIndex
CREATE INDEX "ConversationReview_exotelCallSid_idx" ON "ConversationReview"("exotelCallSid");

-- AddForeignKey
ALTER TABLE "ConversationReview" ADD CONSTRAINT "ConversationReview_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationReview" ADD CONSTRAINT "ConversationReview_sourceActivityId_fkey" FOREIGN KEY ("sourceActivityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationReview" ADD CONSTRAINT "ConversationReview_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationReview" ADD CONSTRAINT "ConversationReview_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
