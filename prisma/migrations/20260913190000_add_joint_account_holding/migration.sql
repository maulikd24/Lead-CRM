-- CreateEnum
CREATE TYPE "OperatingInstruction" AS ENUM ('JOINTLY', 'EITHER_OR_SURVIVOR', 'ANYONE_OR_SURVIVOR');

-- CreateEnum
CREATE TYPE "HolderPosition" AS ENUM ('SECOND', 'THIRD');

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "operatingInstruction" "OperatingInstruction";

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "holderId" TEXT;

-- CreateTable
CREATE TABLE "AccountHolder" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "position" "HolderPosition" NOT NULL,
    "name" TEXT NOT NULL,
    "mobile" TEXT,
    "email" TEXT,
    "pan" TEXT,
    "ckycRef" TEXT,
    "relationToFirstHolder" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountHolder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountHolder_clientId_idx" ON "AccountHolder"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountHolder_clientId_position_key" ON "AccountHolder"("clientId", "position");

-- CreateIndex
CREATE INDEX "Document_holderId_idx" ON "Document"("holderId");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_holderId_fkey" FOREIGN KEY ("holderId") REFERENCES "AccountHolder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountHolder" ADD CONSTRAINT "AccountHolder_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
