-- CreateEnum
CREATE TYPE "TradingAccountType" AS ENUM ('EQUITY', 'COMMODITY', 'CURRENCY', 'MUTUAL_FUND', 'PMS', 'INSURANCE', 'NPS', 'OTHER');

-- CreateEnum
CREATE TYPE "TradingAccountStatus" AS ENUM ('ACTIVE', 'DORMANT', 'CLOSED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "Depository" AS ENUM ('NSDL', 'CDSL');

-- CreateEnum
CREATE TYPE "ProductCategory" AS ENUM ('EQUITY', 'MUTUAL_FUND', 'PMS', 'INSURANCE', 'BOND', 'FIXED_DEPOSIT', 'NPS', 'AIF', 'OTHER');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('BUY', 'SELL', 'SIP', 'REDEMPTION', 'DIVIDEND', 'SWITCH_IN', 'SWITCH_OUT', 'CHARGES', 'OTHER');

-- CreateEnum
CREATE TYPE "EntitlementStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "AdvisoryInteractionType" AS ENUM ('RECOMMENDATION', 'PORTFOLIO_REVIEW', 'RISK_PROFILING', 'COMPLAINT_DISCUSSION', 'OTHER');

-- CreateTable
CREATE TABLE "Household" (
    "id" TEXT NOT NULL,
    "householdCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Household_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Household_householdCode_key" ON "Household"("householdCode");

-- CreateTable
CREATE TABLE "HouseholdMember" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "relationship" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HouseholdMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HouseholdMember_householdId_clientId_key" ON "HouseholdMember"("householdId", "clientId");

-- CreateIndex
CREATE INDEX "HouseholdMember_clientId_idx" ON "HouseholdMember"("clientId");

-- AddForeignKey
ALTER TABLE "HouseholdMember" ADD CONSTRAINT "HouseholdMember_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseholdMember" ADD CONSTRAINT "HouseholdMember_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "TradingAccount" (
    "id" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "accountType" "TradingAccountType" NOT NULL,
    "status" "TradingAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "segments" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "depository" "Depository",
    "dpId" TEXT,
    "boId" TEXT,
    "openedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "rmAtOpeningId" TEXT,
    "sourcingPartnerId" TEXT,
    "sourceSystem" TEXT,
    "externalRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradingAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TradingAccount_accountNumber_key" ON "TradingAccount"("accountNumber");

-- CreateIndex
CREATE UNIQUE INDEX "TradingAccount_sourceSystem_externalRef_key" ON "TradingAccount"("sourceSystem", "externalRef");

-- CreateIndex
CREATE INDEX "TradingAccount_clientId_idx" ON "TradingAccount"("clientId");

-- CreateIndex
CREATE INDEX "TradingAccount_sourcingPartnerId_idx" ON "TradingAccount"("sourcingPartnerId");

-- AddForeignKey
ALTER TABLE "TradingAccount" ADD CONSTRAINT "TradingAccount_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradingAccount" ADD CONSTRAINT "TradingAccount_rmAtOpeningId_fkey" FOREIGN KEY ("rmAtOpeningId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradingAccount" ADD CONSTRAINT "TradingAccount_sourcingPartnerId_fkey" FOREIGN KEY ("sourcingPartnerId") REFERENCES "PartnerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "productCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "ProductCategory" NOT NULL,
    "subCategory" TEXT,
    "isin" TEXT,
    "amcName" TEXT,
    "riskCategory" TEXT,
    "sourceSystem" TEXT,
    "externalRef" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_productCode_key" ON "Product"("productCode");

-- CreateIndex
CREATE UNIQUE INDEX "Product_isin_key" ON "Product"("isin");

-- CreateIndex
CREATE UNIQUE INDEX "Product_sourceSystem_externalRef_key" ON "Product"("sourceSystem", "externalRef");

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "tradingAccountId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL,
    "avgCost" DECIMAL(65,30),
    "currentValue" DECIMAL(65,30),
    "asOfDate" TIMESTAMP(3) NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "externalRef" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Position_sourceSystem_externalRef_asOfDate_key" ON "Position"("sourceSystem", "externalRef", "asOfDate");

-- CreateIndex
CREATE INDEX "Position_tradingAccountId_asOfDate_idx" ON "Position"("tradingAccountId", "asOfDate");

-- CreateIndex
CREATE INDEX "Position_productId_idx" ON "Position"("productId");

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_tradingAccountId_fkey" FOREIGN KEY ("tradingAccountId") REFERENCES "TradingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "tradingAccountId" TEXT NOT NULL,
    "productId" TEXT,
    "transactionType" "TransactionType" NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "settlementDate" TIMESTAMP(3),
    "quantity" DECIMAL(65,30),
    "price" DECIMAL(65,30),
    "grossAmount" DECIMAL(65,30) NOT NULL,
    "netAmount" DECIMAL(65,30),
    "brokerageAmount" DECIMAL(65,30),
    "taxes" JSONB,
    "sourceSystem" TEXT NOT NULL,
    "externalRef" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_sourceSystem_externalRef_key" ON "Transaction"("sourceSystem", "externalRef");

-- CreateIndex
CREATE INDEX "Transaction_tradingAccountId_transactionDate_idx" ON "Transaction"("tradingAccountId", "transactionDate");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_tradingAccountId_fkey" FOREIGN KEY ("tradingAccountId") REFERENCES "TradingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "ProductEntitlement" (
    "id" TEXT NOT NULL,
    "tradingAccountId" TEXT NOT NULL,
    "category" "ProductCategory" NOT NULL,
    "status" "EntitlementStatus" NOT NULL DEFAULT 'ACTIVE',
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "grantedById" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "ProductEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductEntitlement_tradingAccountId_category_key" ON "ProductEntitlement"("tradingAccountId", "category");

-- CreateIndex
CREATE INDEX "ProductEntitlement_tradingAccountId_status_idx" ON "ProductEntitlement"("tradingAccountId", "status");

-- AddForeignKey
ALTER TABLE "ProductEntitlement" ADD CONSTRAINT "ProductEntitlement_tradingAccountId_fkey" FOREIGN KEY ("tradingAccountId") REFERENCES "TradingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductEntitlement" ADD CONSTRAINT "ProductEntitlement_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "AdvisoryInteraction" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "tradingAccountId" TEXT,
    "productId" TEXT,
    "advisorId" TEXT NOT NULL,
    "type" "AdvisoryInteractionType" NOT NULL,
    "recommendation" TEXT,
    "rationale" TEXT,
    "clientRiskProfile" TEXT,
    "interactionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdvisoryInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdvisoryInteraction_clientId_interactionDate_idx" ON "AdvisoryInteraction"("clientId", "interactionDate");

-- CreateIndex
CREATE INDEX "AdvisoryInteraction_tradingAccountId_idx" ON "AdvisoryInteraction"("tradingAccountId");

-- AddForeignKey
ALTER TABLE "AdvisoryInteraction" ADD CONSTRAINT "AdvisoryInteraction_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvisoryInteraction" ADD CONSTRAINT "AdvisoryInteraction_tradingAccountId_fkey" FOREIGN KEY ("tradingAccountId") REFERENCES "TradingAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvisoryInteraction" ADD CONSTRAINT "AdvisoryInteraction_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvisoryInteraction" ADD CONSTRAINT "AdvisoryInteraction_advisorId_fkey" FOREIGN KEY ("advisorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
