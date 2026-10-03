-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('FUNDS_IN', 'FUNDS_OUT', 'FEE', 'OTHER');

-- CreateTable
CREATE TABLE "ClientPayment" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "tradingAccountId" TEXT,
    "paymentType" "PaymentType" NOT NULL DEFAULT 'FUNDS_IN',
    "amount" DECIMAL(65,30) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "mode" TEXT,
    "referenceNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "sourceSystem" TEXT NOT NULL,
    "externalRef" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiSummary" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientPayment_sourceSystem_externalRef_key" ON "ClientPayment"("sourceSystem", "externalRef");
CREATE INDEX "ClientPayment_clientId_paidAt_idx" ON "ClientPayment"("clientId", "paidAt");
CREATE UNIQUE INDEX "AiSummary_kind_subjectKey_contentHash_key" ON "AiSummary"("kind", "subjectKey", "contentHash");
CREATE INDEX "AiSummary_userId_createdAt_idx" ON "AiSummary"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "ClientPayment" ADD CONSTRAINT "ClientPayment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientPayment" ADD CONSTRAINT "ClientPayment_tradingAccountId_fkey" FOREIGN KEY ("tradingAccountId") REFERENCES "TradingAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiSummary" ADD CONSTRAINT "AiSummary_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
