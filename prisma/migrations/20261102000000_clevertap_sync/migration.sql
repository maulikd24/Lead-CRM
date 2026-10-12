-- CreateTable
CREATE TABLE "CleverTapSync" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "lastHash" TEXT NOT NULL,
    "lastPushedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,

    CONSTRAINT "CleverTapSync_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CleverTapSync_clientId_key" ON "CleverTapSync"("clientId");

-- AddForeignKey
ALTER TABLE "CleverTapSync" ADD CONSTRAINT "CleverTapSync_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
