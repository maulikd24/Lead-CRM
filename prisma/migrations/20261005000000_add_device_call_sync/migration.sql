-- CreateTable
CREATE TABLE "DeviceToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "appVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncMatched" INTEGER NOT NULL DEFAULT 0,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "DeviceToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceCall" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "deviceTokenId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "phoneKey" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeviceToken_tokenHash_key" ON "DeviceToken"("tokenHash");
CREATE INDEX "DeviceToken_userId_idx" ON "DeviceToken"("userId");
CREATE UNIQUE INDEX "DeviceCall_activityId_key" ON "DeviceCall"("activityId");
CREATE INDEX "DeviceCall_clientId_startedAt_idx" ON "DeviceCall"("clientId", "startedAt");
CREATE UNIQUE INDEX "DeviceCall_userId_phoneKey_startedAt_direction_key" ON "DeviceCall"("userId", "phoneKey", "startedAt", "direction");

-- AddForeignKey
ALTER TABLE "DeviceToken" ADD CONSTRAINT "DeviceToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DeviceCall" ADD CONSTRAINT "DeviceCall_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DeviceCall" ADD CONSTRAINT "DeviceCall_deviceTokenId_fkey" FOREIGN KEY ("deviceTokenId") REFERENCES "DeviceToken"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DeviceCall" ADD CONSTRAINT "DeviceCall_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
