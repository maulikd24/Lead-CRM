-- AlterTable
ALTER TABLE "User" ADD COLUMN     "dailyBriefOptOut" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "DailyBriefLog" (
    "id" TEXT NOT NULL,
    "rmId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "counts" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyBriefLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyBriefLog_date_idx" ON "DailyBriefLog"("date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyBriefLog_rmId_date_channel_key" ON "DailyBriefLog"("rmId", "date", "channel");

-- AddForeignKey
ALTER TABLE "DailyBriefLog" ADD CONSTRAINT "DailyBriefLog_rmId_fkey" FOREIGN KEY ("rmId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
