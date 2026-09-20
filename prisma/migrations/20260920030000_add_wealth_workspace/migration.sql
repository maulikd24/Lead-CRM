-- CreateTable
CREATE TABLE "WealthHealthCheckup" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "completedAt" TIMESTAMP(3),
    "reportUrl" TEXT,
    "keyFindings" TEXT,
    "performedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WealthHealthCheckup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmartAllvestProfile" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "investorRiskProfile" TEXT,
    "goals" JSONB,
    "investmentHorizonYears" INTEGER,
    "liquidityRequirement" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmartAllvestProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WealthHealthCheckup_clientId_key" ON "WealthHealthCheckup"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "SmartAllvestProfile_clientId_key" ON "SmartAllvestProfile"("clientId");

-- AddForeignKey
ALTER TABLE "WealthHealthCheckup" ADD CONSTRAINT "WealthHealthCheckup_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WealthHealthCheckup" ADD CONSTRAINT "WealthHealthCheckup_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmartAllvestProfile" ADD CONSTRAINT "SmartAllvestProfile_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
