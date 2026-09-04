-- CreateEnum
CREATE TYPE "AvailabilityStatus" AS ENUM ('AVAILABLE', 'ON_LEAVE', 'UNAVAILABLE');

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "ckycRef" TEXT,
ADD COLUMN     "pan" TEXT,
ADD COLUMN     "preferredLanguage" TEXT,
ADD COLUMN     "region" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "availabilityStatus" "AvailabilityStatus" NOT NULL DEFAULT 'AVAILABLE',
ADD COLUMN     "handlesHni" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "regions" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE UNIQUE INDEX "Client_pan_key" ON "Client"("pan");

-- CreateIndex
CREATE UNIQUE INDEX "Client_ckycRef_key" ON "Client"("ckycRef");

