-- CreateTable
CREATE TABLE "DailyJobRun" (
    "id" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "ranForDate" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyJobRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DailyJobRun_jobName_ranForDate_key" ON "DailyJobRun"("jobName", "ranForDate");

-- CreateIndex
CREATE INDEX "Client_updatedAt_idx" ON "Client"("updatedAt");

-- CreateIndex
CREATE INDEX "Client_assignedToId_updatedAt_idx" ON "Client"("assignedToId", "updatedAt");
